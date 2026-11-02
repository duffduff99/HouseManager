"""HTTP endpoints for uploading and downloading attachments.

Uploads: POST /api/house_manager/upload?owner_type=asset&owner_id=<id>
         (multipart form with a "file" field)
Downloads: GET /api/house_manager/file/<attachment_id>
         The panel opens these through a signed URL so the browser doesn't
         need to send an auth header.
"""

from __future__ import annotations

from http import HTTPStatus
import mimetypes
from pathlib import Path
from urllib.parse import quote

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util
from homeassistant.util.ulid import ulid_now

from .const import DOMAIN, MAX_UPLOAD_BYTES
from .manager import HouseManagerError

CHUNK = 64 * 1024
INLINE_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "text/plain",
}


class UploadView(HomeAssistantView):
    url = "/api/house_manager/upload"
    name = "api:house_manager:upload"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        manager = hass.data.get(DOMAIN)
        if manager is None:
            return self.json_message("House Manager is not set up", HTTPStatus.NOT_FOUND)
        try:
            owner = manager.attachment_owner(
                request.query.get("owner_type", ""), request.query.get("owner_id", "")
            )
        except HouseManagerError as err:
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)

        if not request.content_type.startswith("multipart/"):
            return self.json_message("Expected a multipart upload", HTTPStatus.BAD_REQUEST)
        reader = await request.multipart()
        field = await reader.next()
        while field is not None and field.name != "file":
            field = await reader.next()
        if field is None or not field.filename:
            return self.json_message("No file uploaded", HTTPStatus.BAD_REQUEST)

        attachment_id = ulid_now()
        path = manager.file_path(attachment_id)
        await hass.async_add_executor_job(path.parent.mkdir, 0o755, True, True)

        size = 0
        handle = await hass.async_add_executor_job(path.open, "wb")
        try:
            while chunk := await field.read_chunk(CHUNK):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ValueError
                await hass.async_add_executor_job(handle.write, chunk)
        except ValueError:
            await hass.async_add_executor_job(handle.close)
            await hass.async_add_executor_job(path.unlink)
            return self.json_message(
                f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            )
        await hass.async_add_executor_job(handle.close)

        filename = Path(field.filename).name
        attachment = {
            "id": attachment_id,
            "filename": filename,
            "content_type": field.headers.get("Content-Type")
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream",
            "size": size,
            "uploaded": dt_util.now().isoformat(),
        }
        manager.add_attachment(owner, attachment)
        return self.json(attachment)


class FileView(HomeAssistantView):
    url = "/api/house_manager/file/{attachment_id}"
    name = "api:house_manager:file"
    requires_auth = True

    async def get(self, request: web.Request, attachment_id: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]
        manager = hass.data.get(DOMAIN)
        attachment = manager.find_attachment(attachment_id) if manager else None
        if attachment is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        path = manager.file_path(attachment_id)
        if not await hass.async_add_executor_job(path.is_file):
            return web.Response(status=HTTPStatus.NOT_FOUND)
        content_type = attachment["content_type"]
        # Only show "safe" file types in the browser. Anything else (HTML,
        # SVG, ...) is downloaded so it can't run scripts on the HA origin.
        inline = content_type in INLINE_TYPES and not request.query.get("download")
        ascii_name = attachment["filename"].encode("ascii", "ignore").decode().replace('"', "")
        disposition = (
            f'{"inline" if inline else "attachment"}; filename="{ascii_name or "file"}"; '
            f"filename*=UTF-8''{quote(attachment['filename'])}"
        )
        return web.FileResponse(
            path,
            headers={
                "Content-Type": content_type if inline else "application/octet-stream",
                "Content-Disposition": disposition,
                "X-Content-Type-Options": "nosniff",
            },
        )


@callback
def async_register(hass: HomeAssistant) -> None:
    hass.http.register_view(UploadView())
    hass.http.register_view(FileView())

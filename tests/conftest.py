"""Shared test fixtures."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.house_manager.const import DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load integrations from custom_components/."""
    return


@pytest.fixture
async def setup_integration(hass):
    """Set up House Manager and return its manager object."""
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="House Manager")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data

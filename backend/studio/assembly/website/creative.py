"""Preserve website installation transactions while explicitly composing their owners."""

from studio.apps.creative_workshop.catalog import CreativeCatalog
from studio.apps.creative_workshop.catalog_resources import CreativeResources
from studio.apps.creative_workshop.storage.file_paths import CreativeArchiveStaging
from studio.apps.creative_workshop.storage.website_installation import LegacyCreativeInstaller
from studio.apps.creative_workshop.use_cases.installation import CreativeInstaller
from studio.apps.identity.storage.creative_authors import LegacyCreativeAuthors
from studio.apps.integrations.storage.creative_sources import IntegrationCreativeSources
from studio.runtime.secrets import SecretCipher


def website_catalog(session, principal, *, settings, sources=None):
    return CreativeCatalog(
        session,
        principal,
        resources=CreativeResources(
            authors=LegacyCreativeAuthors(session),
            archives=CreativeArchiveStaging(settings),
            settings=settings,
            sources=sources
            if sources is not None
            else IntegrationCreativeSources(session, settings=settings),
        ),
    )


def website_installer(session, principal, *, settings, cipher):
    return CreativeInstaller(
        principal,
        installation=LegacyCreativeInstaller(
            session,
            principal,
            catalog=website_catalog(session, principal, settings=settings),
            settings=settings,
            cipher=cipher,
        ),
    )


def bind_creative(app, settings):
    cipher = SecretCipher(settings.fpl_secrets_key)
    app.state.creative_catalog = lambda _request, session, principal: website_catalog(
        session, principal, settings=settings
    )
    app.state.creative_installer = lambda _request, session, principal: website_installer(
        session, principal, settings=settings, cipher=cipher
    )

"""Construct a website with explicit settings, storage and component lifetimes."""

from fastapi.middleware.cors import CORSMiddleware

from studio.assembly.website.bindings import bind_components
from studio.assembly.website.happier import Happier
from studio.assembly.website.http import create_http_app
from studio.assembly.website.lifecycle import lifespan
from studio.assembly.website.models import WebsiteSession
from studio.runtime.database.website import WebsiteDatabase


def create_app(settings, *, database=None, read_cloud_settings=None):
    database = database or WebsiteDatabase(settings.database_url, session_class=WebsiteSession)
    app = create_http_app(lifespan_context=lifespan)
    app.state.settings, app.state.database = settings, database

    def instance_settings():
        return settings

    read_cloud_settings = read_cloud_settings or instance_settings
    app.state.read_cloud_settings = read_cloud_settings
    app.state.happier = (
        Happier(settings, database.sessions, read_cloud_settings=read_cloud_settings)
        if settings.fpl_happier_origin
        else None
    )
    bind_components(app, settings, database, read_cloud_settings=read_cloud_settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    return app


def from_environment():
    """CLI factory; configuration is loaded only when the host explicitly starts."""
    from studio.config.settings import get_cloud_settings, get_settings

    return create_app(get_settings(), read_cloud_settings=get_cloud_settings)

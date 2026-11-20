# Toonflow upstream components

Source pinned to [HBAI-Ltd/Toonflow-app at 23a5cc94](https://github.com/HBAI-Ltd/Toonflow-app/tree/23a5cc9422f95cee1a66176daf5921c0cfb47bfd), under the included MIT license. TrumanMap comes from `packages/nodes/trumanMap/src`. Its upstream README records the origins and licenses of the procedural assets and bundled animation data.

FPL mounts the manual editor and calls the scene and shot builder with validated script data. FPL supplies canvas nodes, events, storage, and project permission checks. The host exposes private project GLB imports through the existing Assets service. Toonflow's desktop integration, model services, Agent, and dynamic plugins are outside the adapter.

The bundled editor includes the pinned master architecture, objects, nature, and transport catalogs, the dependent upstream sets, the base procedural models and animation data, and FPL's dialogue-room and street sets. The upstream README describes Toonflow's own integration and includes third-party license notices.

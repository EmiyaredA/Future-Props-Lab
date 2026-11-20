"""Map provider behavior to the reference capabilities consumed by Visual."""

from studio.contracts.visual_workshop.visual_generation import VisualReferenceRules


def visual_reference_rules(provider_kind: str, model_slug: str) -> VisualReferenceRules:
    return VisualReferenceRules(
        frame_constraints=provider_kind != "zealman_video",
        supports_subject=provider_kind == "autodl_video" and model_slug == "minimax_h3_zm_titim",
        frame_reference_slots=provider_kind == "autodl_video"
        and model_slug == "minimax_h3_lightx2v",
    )

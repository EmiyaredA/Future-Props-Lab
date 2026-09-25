"""Deterministic native idle behavior mirrored in the browser runtime."""

from __future__ import annotations

import math

from .document import CharacterDocument


def idle_pose(
    doc: CharacterDocument,
    base: dict[str, float],
    elapsed_ms: float,
    motion_id: str | None = None,
    expression_id: str | None = None,
) -> tuple[dict[str, float], dict[str, float]]:
    values = base.copy()
    rotations: dict[str, float] = {}
    behavior = doc.idle_behavior
    if behavior.intensity <= 0:
        return values, rotations
    motion = next((item for item in doc.motions if item.id == motion_id), None)
    expression = next((item for item in doc.expressions if item.id == expression_id), None)
    controlled = {track.parameter_id for track in motion.tracks} if motion else set()
    controlled.update(expression.values if expression else {})
    parameters = {item.id: item for item in doc.parameters}
    seconds = elapsed_ms / 1000
    intensity = behavior.intensity

    def apply(identifier: str | None, amount: float) -> None:
        if identifier is None or identifier in controlled or identifier not in parameters:
            return
        parameter = parameters[identifier]
        values[identifier] = max(
            parameter.minimum,
            min(parameter.maximum, parameter.default + amount * intensity),
        )

    cycle = math.floor(elapsed_ms / 3300)
    closure = 0.0
    for index in range(cycle - 1, cycle + 2):
        center = index * 3300 + 1700 + 430 * math.sin(index * 1.618)
        closure = max(closure, max(0, 1 - abs(elapsed_ms - center) / 125))
    blink_default = (
        parameters[behavior.blink_parameter].default
        if behavior.blink_parameter in parameters
        else 1
    )
    apply(behavior.blink_parameter, 1 - closure - blink_default)
    apply(
        behavior.gaze_x_parameter, 0.46 * math.sin(seconds * 0.73) + 0.14 * math.sin(seconds * 1.37)
    )
    apply(behavior.gaze_y_parameter, 0.3 * math.sin(seconds * 0.48 + 0.7))
    apply(behavior.breath_parameter, math.sin(seconds * 1.31) * 0.65)
    apply(
        behavior.sway_parameter, 0.55 * math.sin(seconds * 0.91) + 0.15 * math.sin(seconds * 1.57)
    )
    bones = {item.id: item for item in doc.bones}
    for index, identifier in enumerate(behavior.spring_bones):
        bone = bones.get(identifier)
        if bone is None:
            continue
        rotations[identifier] = (
            (
                1.4 * math.sin(seconds * (1.08 + index * 0.18) + index * 1.3)
                + 0.45 * math.sin(seconds * (1.72 + index * 0.11))
            )
            * bone.spring
            * intensity
        )
    return values, rotations

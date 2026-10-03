/** Contact shadow fades out as the feet leave the floor. */
export function contactShadow(scale, lift, squash, dragged) {
  const contact = Math.max(
    0,
    Math.min(1, 1 - Math.max(0, lift) / (60 * scale)),
  );
  return {
    rx: 42 * scale * (0.8 + 0.2 * contact) * (1 + squash * 0.25),
    ry: 6 * scale + 1,
    opacity: dragged ? 0 : 0.12 * contact * contact,
  };
}

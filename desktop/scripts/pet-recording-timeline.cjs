// Self-contained so Playwright can install the same diagnostic rules in a page.
function installPetRecordingTimeline() {
  function cache(initial) {
    let environment = initial,
      confirmation = null,
      sequence = -1;
    const stale = (next) =>
      next.revision < environment.revision ||
      next.generation < environment.generation;
    return {
      external(next) {
        if (stale(next))
          return { accepted: false, reason: "stale-environment" };
        if (next.generation !== environment.generation) sequence = -1;
        environment = next;
        // An external event changes trajectory ownership even when generation
        // happens to remain equal. Never label its placement with an old receipt.
        confirmation = null;
        return { accepted: true };
      },
      receipt(value, clock) {
        const next = value.environment;
        if (stale(next))
          return { accepted: false, reason: "stale-environment" };
        if (
          next.generation === environment.generation &&
          value.sequence <= sequence
        )
          return { accepted: false, reason: "stale-sequence" };
        environment = next;
        sequence = value.sequence;
        confirmation = {
          sequence,
          generation: next.generation,
          revision: next.revision,
          ...clock,
        };
        return { accepted: true };
      },
      read() {
        return { environment, confirmation };
      },
    };
  }

  function sampler({ interval = 0.1, stop = 0.6, tail = 0.3 } = {}) {
    let deadline = 0,
      previous = "",
      changed = 0,
      wasActive = false,
      recoveryUntil = -1;
    return (seconds, signature, active, stage) => {
      if (signature !== previous) {
        previous = signature;
        changed = seconds;
      }
      if (wasActive && !active) recoveryUntil = seconds + stop + tail;
      wasActive = active;
      const due = seconds + 1e-9 >= deadline;
      if (due) {
        // Advance the fixed schedule, emitting this actual frame only once.
        // Missed deadlines are recorded as gaps, never filled with duplicates.
        deadline = (Math.floor((seconds + 1e-9) / interval) + 1) * interval;
      }
      return (
        due ||
        seconds - changed < tail ||
        (active && stage !== "loop") ||
        seconds <= recoveryUntil
      );
    };
  }

  const tools = { cache, sampler };
  if (typeof window !== "undefined") {
    window.petRecordingTimelineTools = tools;
    return;
  }
  return tools;
}
module.exports = { installPetRecordingTimeline };

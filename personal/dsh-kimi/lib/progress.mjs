// Progress is a lightweight status projection; the final transcript keeps full details.
const present = value => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

export function progressTurn(turn) {
  return present({
    turnId: turn.turnId, triggerPromptId: turn.triggerPromptId,
    state: turn.state, agentId: turn.agentId,
    steps: (turn.steps ?? []).map(step => present({
      stepId: step.stepId, state: step.state,
      frames: (step.frames ?? []).filter(frame => frame.kind === 'tool').map(frame => present({
        kind: frame.kind, frameId: frame.frameId, name: frame.name,
        state: frame.state, agentRefs: frame.agentRefs,
      })),
    })),
  });
}

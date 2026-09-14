// Progress is a lightweight status projection; the final transcript keeps full details.
export function progressTurn(turn) {
  return {
    turnId: turn.turnId, triggerPromptId: turn.triggerPromptId,
    state: turn.state, agentId: turn.agentId,
    steps: (turn.steps ?? []).map(step => ({
      stepId: step.stepId, state: step.state,
      frames: (step.frames ?? []).filter(frame => frame.kind === 'tool').map(frame => ({
        kind: frame.kind, frameId: frame.frameId, name: frame.name,
        state: frame.state, agentRefs: frame.agentRefs,
      })),
    })),
  };
}

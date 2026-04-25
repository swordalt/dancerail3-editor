export const EDITOR_KEYBIND_GROUPS = [
  {
    title: 'Playback and Navigation',
    bindings: [
      { keys: ['Space'], description: 'Play or pause the song from the current editor time.' },
      { keys: ['Mouse wheel'], description: 'Move through the timeline. Scrolling stops playback before seeking.' },
    ],
  },
  {
    title: 'Grid and View',
    bindings: [
      { keys: ['W'], description: 'Increase snap precision.' },
      { keys: ['S'], description: 'Decrease snap precision.' },
      { keys: ['R'], description: 'Zoom the timeline in by increasing pixels per beat.' },
      { keys: ['F'], description: 'Zoom the timeline out by decreasing pixels per beat.' },
    ],
  },
  {
    title: 'Note Tools',
    bindings: [
      { keys: ['A'], description: 'Select the previous note type.' },
      { keys: ['D'], description: 'Select the next note type.' },
      { keys: ['Q'], description: 'Decrease the placement note width.' },
      { keys: ['E'], description: 'Increase the placement note width.' },
    ],
  },
  {
    title: 'Canvas Editing',
    bindings: [
      { keys: ['Left click'], description: 'Place the selected note type on the snapped grid position.' },
      { keys: ['Right click'], description: 'Delete the clicked note, or delete the selected group when clicking a selected note.' },
      { keys: ['Middle click note'], description: 'Select the clicked note.' },
      { keys: ['Middle drag empty space'], description: 'Draw a selection box.' },
      { keys: ['Ctrl', 'Left click note'], description: 'Toggle a note in or out of the current selection.' },
      { keys: ['Shift', 'Left click note'], description: 'Start moving the clicked note.' },
      { keys: ['Shift', 'Middle click note'], description: 'Start moving the clicked note.' },
      { keys: ['Delete'], description: 'Delete all selected notes.' },
      { keys: ['Backspace'], description: 'Delete all selected notes.' },
    ],
  },
  {
    title: 'Fields',
    bindings: [
      { keys: ['Enter'], description: 'Commit the current input value and leave the field.' },
    ],
  },
] as const;

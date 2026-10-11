import type { Diagnosis } from '../../src/diagnosis/schema.js';
import type { Shell, Suggestion } from '../../src/suggest/suggest.js';
import {
  diagnose,
  getProviders,
  suggest,
  type DiagnoseResponse,
  type ProviderInfo,
  type SuggestResponse,
} from './api.js';
import { abstainText, prepareInput, privacyNotice, type ApprovalMode } from './lib.js';
import type { TerminalHandle } from './terminal.js';

// All text below comes from a model or the terminal, so it is only ever set with textContent.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderDiagnosis(d: Diagnosis): HTMLElement {
  const box = el('div');
  box.append(el('p', d.summary), el('p', `Category: ${d.category}`, 'muted'));

  for (const cause of d.likelyCauses) {
    const item = el('div');
    item.append(el('strong', `${cause.cause} `), el('span', cause.confidence, 'badge review'));
    for (const quote of cause.evidence) {
      const q = el('blockquote');
      q.append(el('code', quote));
      item.append(q);
    }
    if (cause.sources.length > 0) {
      item.append(el('div', `Sources: ${cause.sources.join(', ')}`, 'muted'));
    }
    box.append(item);
  }

  if (d.suggestedSteps.length > 0) box.append(el('h4', 'Suggested steps (nothing is run for you)'));
  for (const step of d.suggestedSteps) {
    const row = el('div', '', 'row');
    row.append(el('span', step.description));
    if (step.command) {
      row.append(el('code', step.command));
      if (step.risk) row.append(el('span', step.risk, `badge ${step.risk}`));
      const copy = el('button', 'Copy');
      copy.onclick = () => void navigator.clipboard.writeText(step.command!);
      row.append(copy);
    }
    box.append(row);
  }

  const notes: string[] = [];
  if (d.droppedClaims > 0) notes.push(`${d.droppedClaims} unverifiable claim(s) were dropped`);
  if (d.redactions > 0) notes.push(`${d.redactions} secret(s) were redacted before sending`);
  if (d.truncatedInput) notes.push('the input was truncated to its end');
  if (notes.length > 0) box.append(el('div', notes.join('; '), 'muted'));
  return box;
}

function renderResponse(response: DiagnoseResponse): HTMLElement {
  const box = el('div');
  const header = el('div', '', 'row');
  header.append(
    el('span', 'Handled by'),
    el('strong', response.provider.label),
    el('span', response.provider.privacy, `badge ${response.provider.privacy}`),
  );
  box.append(header);

  if (response.result.abstained) {
    box.append(el('p', abstainText(response.result.cause)));
    box.append(el('p', response.result.reason, 'muted'));
  } else {
    box.append(renderDiagnosis(response.result.diagnosis));
  }
  return box;
}

/** A collapsible panel with "explain" actions. Nothing is sent until a button is pressed. */
export function mountAiPanel(panel: HTMLElement, terminal: TerminalHandle): void {
  const toggle = el('button', 'AI');
  toggle.id = 'ai-toggle';
  document.body.append(toggle);
  toggle.onclick = () => (panel.hidden = !panel.hidden);

  const select = el('select');
  const badge = el('span', '', 'badge');
  const explainSelection = el('button', 'Explain selection');
  const explainLast = el('button', 'Explain last output');
  const controls = el('div', '', 'row');
  controls.append(select, badge, explainSelection, explainLast);
  const output = el('div');

  // "Ask": natural language -> commands. Nothing is typed into the terminal until a button is pressed.
  const instruction = el('input');
  instruction.placeholder = 'What do you want to do? e.g. what is using port 3000';
  instruction.style.flex = '1 1 240px';
  const shellSelect = el('select');
  const SHELL_OPTIONS: Shell[] = ['powershell', 'bash', 'cmd'];
  for (const shell of SHELL_OPTIONS) shellSelect.append(new Option(shell, shell));
  const includeOutput = el('input');
  includeOutput.type = 'checkbox';
  const includeLabel = el('label', ' include last output as context');
  includeLabel.prepend(includeOutput);
  const askButton = el('button', 'Suggest commands');
  const askRow = el('div', '', 'row');
  askRow.append(instruction, shellSelect, includeLabel, askButton);

  panel.append(controls, askRow, output);

  let providers: ProviderInfo[] = [];
  const current = () => providers.find((p) => p.name === select.value);
  const refreshBadge = () => {
    const p = current();
    badge.textContent = p
      ? p.privacy === 'local'
        ? 'local: stays on this PC'
        : 'cloud: leaves this PC'
      : '';
    badge.className = `badge ${p?.privacy ?? ''}`;
  };
  select.onchange = refreshBadge;

  getProviders()
    .then((data) => {
      providers = data.providers.filter((p) => p.available);
      for (const p of providers) select.append(new Option(`${p.label} (${p.privacy})`, p.name));
      select.value = data.default;
      refreshBadge();
    })
    .catch((e: Error) => output.replaceChildren(el('p', `Could not load providers: ${e.message}`)));

  async function run(text: string): Promise<void> {
    const provider = current();
    if (!provider) return void output.replaceChildren(el('p', 'No provider is configured.'));
    if (text.trim() === '') {
      return void output.replaceChildren(el('p', abstainText('empty_input')));
    }
    if (provider.privacy === 'cloud' && !confirm(privacyNotice(provider, text.length))) return;

    output.replaceChildren(el('p', `Asking ${provider.label}...`, 'muted'));
    try {
      const response = await diagnose(text, provider.name, provider.privacy === 'cloud');
      output.replaceChildren(renderResponse(response));
    } catch (error) {
      output.replaceChildren(el('p', (error as Error).message));
    }
  }

  function renderSuggestions(response: SuggestResponse): HTMLElement {
    const box = el('div');
    const header = el('div', '', 'row');
    header.append(
      el('span', 'Handled by'),
      el('strong', response.provider.label),
      el('span', response.provider.privacy, `badge ${response.provider.privacy}`),
    );
    box.append(header);

    const result = response.result;
    if (!result.ok) {
      box.append(el('p', result.reason));
      return box;
    }
    if (result.clarification) box.append(el('p', result.clarification));

    for (const s of result.suggestions) box.append(suggestionCard(s));
    if (result.suggestions.length > 0) {
      box.append(
        el(
          'div',
          'Insert types the command so you can review it and press Enter yourself. ' +
            'Run types it and presses Enter. Dangerous commands ask again.',
          'muted',
        ),
      );
    }
    if (result.redactions > 0) {
      box.append(el('div', `${result.redactions} secret(s) were redacted before sending`, 'muted'));
    }
    return box;
  }

  function suggestionCard(s: Suggestion): HTMLElement {
    const card = el('div', '', 'row');
    card.append(
      el('span', s.explanation),
      el('code', s.command),
      el('span', s.risk, `badge ${s.risk}`),
    );

    const send = (mode: ApprovalMode) => (event: MouseEvent) => {
      if (!event.isTrusted) return; // only a real click is an approval
      const data = prepareInput(s.command, mode, s.risk, () =>
        confirm(`This command looks dangerous:\n\n${s.command}\n\nRun it anyway?`),
      );
      if (data !== null) terminal.type(data);
    };
    const insert = el('button', 'Insert');
    insert.onclick = send('insert');
    const runButton = el('button', 'Run');
    runButton.onclick = send('run');
    const copy = el('button', 'Copy');
    copy.onclick = () => void navigator.clipboard.writeText(s.command);
    card.append(insert, runButton, copy);
    return card;
  }

  async function ask(): Promise<void> {
    const provider = current();
    const text = instruction.value.trim();
    if (!provider) return void output.replaceChildren(el('p', 'No provider is configured.'));
    if (text === '') return void output.replaceChildren(el('p', 'Describe what you want to do.'));

    const context = includeOutput.checked ? terminal.tail(40) : undefined;
    const sentChars = text.length + (context?.length ?? 0);
    if (provider.privacy === 'cloud' && !confirm(privacyNotice(provider, sentChars))) return;

    output.replaceChildren(el('p', `Asking ${provider.label}...`, 'muted'));
    try {
      const response = await suggest(text, {
        provider: provider.name,
        confirmCloud: provider.privacy === 'cloud',
        shell: shellSelect.value as Shell,
        context,
      });
      output.replaceChildren(renderSuggestions(response));
    } catch (error) {
      output.replaceChildren(el('p', (error as Error).message));
    }
  }
  askButton.onclick = () => void ask();
  instruction.addEventListener('keydown', (e) => e.key === 'Enter' && void ask());

  // Keep the terminal selection alive when a button is pressed.
  for (const b of [explainSelection, explainLast, toggle, askButton]) {
    b.addEventListener('pointerdown', (e) => e.preventDefault());
  }
  explainSelection.onclick = () => void run(terminal.selection());
  explainLast.onclick = () => void run(terminal.tail(60));
}

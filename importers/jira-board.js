const { createHash } = require('node:crypto');

function workflowStage(statusName, columnName, category) {
  const label = (String(statusName ?? '') + ' ' + String(columnName ?? ''))
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (category === 'done' || /\b(done|closed|resolved|erledigt|abgeschlossen)\b/.test(label)) return 'done';
  if (/review|prufung|abnahme|verification|\bqa\b/.test(label)) return 'review';
  if (category === 'indeterminate' || category === 'in-progress') return 'implementation';
  return 'clarification';
}

function stageFor(issue, board) {
  const status = issue.fields?.status ?? {};
  const column = board.columnConfig?.columns?.find(entry =>
    entry.statuses?.some(item => String(item.id) === String(status.id)));
  const fromBoard = column?.statuses.find(item => String(item.id) === String(status.id));
  const category = status.statusCategory?.key ?? issue.fields?.statusCategory?.key ?? fromBoard?.category;
  return workflowStage(status.name, column?.name, category);
}

function jiraBoardLayout(source, board) {
  return {
    id: source.cloudId + ':' + source.boardId,
    title: board.name || source.projectKey + ' board ' + source.boardId,
    columns: (board.columnConfig?.columns ?? []).map((column, index) => ({
      id: String(index),
      name: column.name,
      statuses: (column.statuses ?? []).filter(status => status.id != null).map(status => ({
        id: String(status.id),
        stage: workflowStage(status.name, column.name, status.category),
      })),
    })),
  };
}

function jiraTicketPlacement(issue, source, board) {
  const hash = createHash('sha256').update(source.cloudId + ':' + (issue.id ?? issue.key)).digest('hex').slice(0, 20);
  const statusId = issue.fields?.status?.id;
  return {
    id: 'jira-' + hash + '-' + issue.key.toLowerCase(),
    stage: stageFor(issue, board),
    jiraStatusId: statusId == null ? null : String(statusId),
  };
}

module.exports = { stageFor, jiraBoardLayout, jiraTicketPlacement };

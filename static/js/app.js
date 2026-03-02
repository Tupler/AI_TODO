(function () {
  const API = '/api/tasks';
  let currentFilter = 'all';
  let searchQuery = '';
  let viewDate = getTodayStr();
  let tasks = [];

  const $list = document.getElementById('task-list');
  const $addForm = document.getElementById('add-form');
  const $taskTitle = document.getElementById('task-title');
  const $taskDue = document.getElementById('task-due');
  const $taskRecurrence = document.getElementById('task-recurrence');
  const $addError = document.getElementById('add-error');
  const $search = document.getElementById('search');
  const $viewDate = document.getElementById('view-date');
  const $emptyHint = document.getElementById('empty-hint');
  const $loadError = document.getElementById('load-error');
  const $batchDelete = document.getElementById('batch-delete');
  const $clearCompleted = document.getElementById('clear-completed');

  function getTodayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const recurrenceLabel = { none: '不重复', daily: '每天', weekly: '每周', monthly: '每月' };

  function showError(el, msg) {
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function fetchTasks() {
    const params = new URLSearchParams({ filter: currentFilter, date: viewDate });
    return fetch(API + '?' + params.toString())
      .then((r) => r.json())
      .then((data) => {
        tasks = data;
        render();
        showError($loadError, '');
        return data;
      })
      .catch((err) => {
        showError($loadError, '加载任务失败，请刷新重试');
        console.error(err);
      });
  }

  function filterAndSearch(list) {
    let out = list.slice();
    if (searchQuery) {
      const q = searchQuery.trim().toLowerCase();
      out = out.filter((t) => t.title.toLowerCase().includes(q));
    }
    return out;
  }

  function render() {
    const filtered = filterAndSearch(tasks);
    $list.innerHTML = '';
    filtered.forEach((task) => {
      const li = document.createElement('li');
      li.className = 'task-item' + (task.completed ? ' completed' : '');
      li.dataset.id = task.id;

      const metaParts = [];
      if (task.due_date) metaParts.push('<span>截止: ' + task.due_date + '</span>');
      if (task.recurrence && task.recurrence !== 'none')
        metaParts.push('<span>' + (recurrenceLabel[task.recurrence] || task.recurrence) + '</span>');

      li.innerHTML =
        '<label class="task-check-wrap batch-check-wrap" title="选择以批量删除">' +
        '<input type="checkbox" class="batch-select" data-id="' +
        task.id +
        '">' +
        '</label>' +
        '<label class="task-check-wrap complete-check-wrap" title="标记完成">' +
        '<input type="checkbox" class="complete-check" ' +
        (task.completed ? 'checked' : '') +
        ' data-id="' +
        task.id +
        '">' +
        '</label>' +
        '<div class="task-content">' +
        '<div class="task-title" data-id="' +
        task.id +
        '">' +
        escapeHtml(task.title) +
        '</div>' +
        (metaParts.length ? '<div class="task-meta">' + metaParts.join('') + '</div>' : '') +
        '</div>' +
        '<div class="task-actions">' +
        '<button type="button" class="edit-btn" data-id="' +
        task.id +
        '">编辑</button>' +
        '<button type="button" class="delete-btn" data-id="' +
        task.id +
        '">删除</button>' +
        '</div>';

      $list.appendChild(li);
    });

    $emptyHint.classList.toggle('hidden', filtered.length > 0);
    updateBatchDeleteState();
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function updateBatchDeleteState() {
    const checked = document.querySelectorAll('.batch-select:checked');
    $batchDelete.disabled = checked.length === 0;
  }

  $list.addEventListener('change', (e) => {
    if (e.target.classList.contains('complete-check')) {
      const id = parseInt(e.target.dataset.id, 10);
      const completed = e.target.checked;
      fetch(API + '/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: completed, view_date: viewDate }),
      })
        .then((r) => r.json())
        .then(() => fetchTasks())
        .catch(() => {});
    }
    if (e.target.classList.contains('batch-select')) {
      updateBatchDeleteState();
    }
  });

  $list.addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.id;
    if (!id) return;
    const numId = parseInt(id, 10);

    if (e.target.classList.contains('delete-btn')) {
      if (!confirm('确定删除这条任务？')) return;
      fetch(API + '/' + numId, { method: 'DELETE' })
        .then(() => fetchTasks())
        .catch(() => {});
      return;
    }

    if (e.target.classList.contains('edit-btn')) {
      const item = e.target.closest('.task-item');
      const titleEl = item.querySelector('.task-title');
      if (titleEl.classList.contains('inline-edit')) return;
      const orig = titleEl.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'task-title inline-edit';
      input.value = orig;
      input.dataset.id = id;
      titleEl.replaceWith(input);
      input.focus();
      input.select();

      function saveEdit() {
        const val = input.value.trim();
        input.classList.remove('inline-edit');
        const div = document.createElement('div');
        div.className = 'task-title';
        div.dataset.id = id;
        div.textContent = val || orig;
        input.replaceWith(div);
        if (val && val !== orig) {
          fetch(API + '/' + numId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: val }),
          })
            .then((r) => r.json())
            .then((task) => {
              const idx = tasks.findIndex((t) => t.id === task.id);
              if (idx !== -1) tasks[idx] = task;
              div.textContent = task.title;
            })
            .catch(() => {});
        }
      }

      input.addEventListener('blur', saveEdit, { once: true });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          input.blur();
        }
        if (ev.key === 'Escape') {
          input.value = orig;
          input.blur();
        }
      });
    }
  });

  $addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    showError($addError, '');
    const title = $taskTitle.value.trim();
    if (!title) {
      showError($addError, '请输入任务内容');
      return;
    }
    const due = $taskDue.value || null;
    const recurrence = $taskRecurrence.value || 'none';

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, due_date: due, recurrence: recurrence }),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.error || '添加失败'));
        return r.json();
      })
      .then(() => {
        $taskTitle.value = '';
        $taskDue.value = '';
        $taskRecurrence.value = 'none';
        return fetchTasks();
      })
      .catch((err) => {
        showError($addError, typeof err === 'string' ? err : '添加失败，请重试');
      });
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      fetchTasks();
    });
  });

  $search.addEventListener('input', () => {
    searchQuery = $search.value;
    render();
  });

  $batchDelete.addEventListener('click', () => {
    const ids = Array.from(document.querySelectorAll('.batch-select:checked')).map((el) =>
      parseInt(el.dataset.id, 10)
    );
    if (ids.length === 0) return;
    if (!confirm('确定删除选中的 ' + ids.length + ' 条任务？')) return;
    fetch(API + '/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids }),
    })
      .then(() => fetchTasks())
      .catch(() => {});
  });

  $clearCompleted.addEventListener('click', () => {
    fetch(API + '/clear-completed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_date: viewDate }),
    }).then(() => fetchTasks()).catch(() => {});
  });

  if ($viewDate) {
    $viewDate.value = viewDate;
    $viewDate.addEventListener('change', () => {
      viewDate = $viewDate.value || getTodayStr();
      fetchTasks();
    });
  }

  /* 每小时提醒：右下角弹出当日未完成任务 */
  const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
  const REMINDER_FIRST_DELAY_MS = 3 * 1000;

  function showReminderToast(activeTasks) {
    const container = document.getElementById('reminder-toast-container');
    if (!container) return;
    const existing = container.querySelector('.reminder-toast');
    if (existing) existing.remove();
    const today = getTodayStr();
    const toast = document.createElement('div');
    toast.className = 'reminder-toast';
    if (activeTasks.length === 0) {
      toast.innerHTML =
        '<h3>提醒 <button type="button" class="reminder-close" aria-label="关闭">×</button></h3>' +
        '<p class="reminder-empty">今日暂无未完成任务</p>';
    } else {
      const listHtml = activeTasks.map((t) => '<li>' + escapeHtml(t.title) + '</li>').join('');
      toast.innerHTML =
        '<h3>今日未完成任务 (' +
        activeTasks.length +
        ') <button type="button" class="reminder-close" aria-label="关闭">×</button></h3>' +
        '<ul>' +
        listHtml +
        '</ul>';
    }
    toast.querySelector('.reminder-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 12000);
  }

  function runReminder() {
    const today = getTodayStr();
    const params = new URLSearchParams({ filter: 'active', date: today });
    fetch(API + '?' + params.toString())
      .then((r) => r.json())
      .then((list) => showReminderToast(list))
      .catch(() => {});
  }

  setTimeout(runReminder, REMINDER_FIRST_DELAY_MS);
  setInterval(runReminder, REMINDER_INTERVAL_MS);

  fetchTasks();
})();

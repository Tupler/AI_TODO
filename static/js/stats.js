(function () {
  const API = '/api/stats/daily';
  let userCode = localStorage.getItem('todoUserCode') || '';

  const $monthInput = document.getElementById('month-input');
  const $calendarBody = document.getElementById('stats-calendar-body');
  const $summary = document.getElementById('stats-summary-text');
  const $error = document.getElementById('stats-error');

  function getCurrentMonthStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  function showError(msg) {
    if (!$error) return;
    $error.textContent = msg || '';
  }

  function ensureUserCodeForStats() {
    if (!userCode) {
      showError('请先在首页输入识别码，然后再打开统计页面。');
      return false;
    }
    showError('');
    return true;
  }

  function fetchStats() {
    if (!ensureUserCodeForStats()) return;
    if (!$monthInput || !$calendarBody) return;
    const month = $monthInput.value || getCurrentMonthStr();
    const params = new URLSearchParams({ month: month, user_code: userCode });
    fetch(API + '?' + params.toString())
      .then((r) => r.json())
      .then((data) => {
        const days = data.days || [];
        renderCalendar(month, days);
        const completedTotal = days.reduce((sum, d) => sum + (d.completed_count || 0), 0);
        const unfinishedTotal = days.reduce((sum, d) => sum + (d.unfinished_count || 0), 0);
        if ($summary) {
          $summary.textContent =
            '本月完成任务 ' +
            completedTotal +
            ' 条，未完成任务 ' +
            unfinishedTotal +
            ' 条。';
        }
        showError('');
      })
      .catch(() => {
        showError('加载统计数据失败，请稍后重试。');
      });
  }

  function renderCalendar(monthStr, days) {
    if (!$calendarBody) return;
    $calendarBody.innerHTML = '';
    const map = {};
    days.forEach((d) => {
      map[d.date] = {
        completed: d.completed_count || 0,
        unfinished: d.unfinished_count || 0,
        total: d.total_count || (d.completed_count || 0) + (d.unfinished_count || 0),
      };
    });

    const firstDate = new Date(monthStr + '-01T00:00:00');
    if (isNaN(firstDate.getTime())) return;

    const year = firstDate.getFullYear();
    const month = firstDate.getMonth(); // 0-based
    const lastDate = new Date(year, month + 1, 0);
    const daysInMonth = lastDate.getDate();

    // 以周一为一周开始，0=周日 => 7
    const jsWeekday = firstDate.getDay(); // 0-6, Sun=0
    const startCol = jsWeekday === 0 ? 7 : jsWeekday; // 1-7

    for (let i = 1; i < startCol; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'stats-day-cell empty';
      $calendarBody.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const iso = d.toISOString().slice(0, 10);
      const info = map[iso] || { completed: 0, unfinished: 0, total: 0 };
      const completed = info.completed;
      const unfinished = info.unfinished;
      const total = info.total;

      const cell = document.createElement('div');
      cell.className = 'stats-day-cell' + (total > 0 ? ' has-data' : '');

      const label = document.createElement('div');
      label.className = 'date-label';
      label.textContent = String(day);

      const countLabel = document.createElement('div');
      countLabel.className = 'count-label';
      if (total > 0) {
        countLabel.textContent =
          '完成 ' + completed + ' 条，未完成 ' + Math.max(unfinished, 0) + ' 条';
      } else {
        countLabel.textContent = '暂无任务';
      }

      cell.appendChild(label);
      cell.appendChild(countLabel);
      $calendarBody.appendChild(cell);
    }
  }

  function init() {
    if ($monthInput) {
      const current = getCurrentMonthStr();
      $monthInput.value = current;
      $monthInput.addEventListener('change', fetchStats);
    }
    if (ensureUserCodeForStats()) {
      fetchStats();
    }
  }

  init();
})();


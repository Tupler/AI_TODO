# -*- coding: utf-8 -*-
import os
from datetime import datetime, date
import calendar
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL', 'sqlite:///todo.db'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

db = SQLAlchemy(app)

# 重复类型: none, daily, weekly, monthly
RECURRENCE_CHOICES = ['none', 'daily', 'weekly', 'monthly']


class Task(db.Model):
    __tablename__ = 'tasks'
    id = db.Column(db.Integer, primary_key=True)
    # 识别码，用来区分不同用户的 TODO 空间
    user_code = db.Column(db.String(64), nullable=False, index=True)
    title = db.Column(db.String(256), nullable=False)
    due_date = db.Column(db.Date, nullable=True)
    recurrence = db.Column(db.String(20), default='none')
    completed = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, completed_override=None):
        completed = completed_override if completed_override is not None else self.completed
        return {
            'id': self.id,
            'user_code': self.user_code,
            'title': self.title,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'recurrence': self.recurrence,
            'completed': completed,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class TaskCompletion(db.Model):
    """重复任务按日期记录完成状态，避免“今天完成明天仍显示完成”。"""
    __tablename__ = 'task_completions'
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False)
    completed_date = db.Column(db.Date, nullable=False)
    __table_args__ = (db.UniqueConstraint('task_id', 'completed_date', name='uq_task_date'),)


with app.app_context():
    db.create_all()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/stats')
def stats_page():
    return render_template('stats.html')


def task_applies_on_date(task, d):
    """判断任务在日期 d 是否应显示（按重复规则）。"""
    if task.recurrence == 'daily':
        return True
    if task.recurrence == 'none':
        if task.due_date is None:
            return True  # 无截止日期：每天显示
        return task.due_date == d
    anchor_date = task.due_date if task.due_date else task.created_at.date()
    if task.recurrence == 'weekly':
        return d.weekday() == anchor_date.weekday()  # 0=周一 … 6=周日
    if task.recurrence == 'monthly':
        return d.day == anchor_date.day  # 每月同一天
    return False


@app.route('/api/tasks', methods=['GET'])
def list_tasks():
    """列表：支持筛选 all | active | completed，以及按 date 显示当天任务（含重复规则），并按 user_code 隔离。"""
    user_code = (request.args.get('user_code') or '').strip()
    if not user_code:
        # 没有识别码时直接返回空列表，前端会先要求输入识别码
        return jsonify([])

    filter_type = request.args.get('filter', 'all')
    date_str = request.args.get('date')
    view_date = None
    if date_str:
        try:
            view_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            pass

    q = Task.query.filter_by(user_code=user_code).order_by(Task.created_at.desc())
    tasks = q.all()
    if view_date is not None:
        tasks = [t for t in tasks if task_applies_on_date(t, view_date)]
    # 重复任务按“查看日期”判断是否完成；非重复用 task.completed
    completed_for_date = set()
    if view_date is not None and tasks:
        task_ids = [t.id for t in tasks]
        completed_for_date = {
            c.task_id
            for c in TaskCompletion.query.filter(
                TaskCompletion.task_id.in_(task_ids),
                TaskCompletion.completed_date == view_date,
            ).all()
        }
    result = []
    for t in tasks:
        if view_date is not None and t.recurrence != 'none':
            completed = t.id in completed_for_date
        else:
            completed = t.completed
        if filter_type == 'active' and completed:
            continue
        if filter_type == 'completed' and not completed:
            continue
        result.append(t.to_dict(completed_override=completed))
    return jsonify(result)


@app.route('/api/tasks', methods=['POST'])
def add_task():
    data = request.get_json() or {}
    user_code = (data.get('user_code') or '').strip()
    if not user_code:
        return jsonify({'error': '识别码不能为空'}), 400

    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': '标题不能为空'}), 400
    due = data.get('due_date')
    if due:
        try:
            due = datetime.strptime(due, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            due = None
    recurrence = data.get('recurrence', 'none')
    if recurrence not in RECURRENCE_CHOICES:
        recurrence = 'none'
    task = Task(user_code=user_code, title=title, due_date=due, recurrence=recurrence)
    db.session.add(task)
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route('/api/tasks/<int:task_id>', methods=['PATCH'])
def update_task(task_id):
    task = Task.query.get_or_404(task_id)
    data = request.get_json() or {}
    # 简单的 user_code 校验，防止跨识别码修改
    req_user_code = (data.get('user_code') or '').strip()
    if req_user_code and task.user_code != req_user_code:
        return jsonify({'error': 'not found'}), 404

    response_completed_override = None
    if 'title' in data:
        task.title = (data['title'] or '').strip() or task.title
    if 'completed' in data:
        completed = bool(data['completed'])
        view_date_str = data.get('view_date')
        if task.recurrence != 'none' and view_date_str:
            try:
                view_date = datetime.strptime(view_date_str, '%Y-%m-%d').date()
            except (ValueError, TypeError):
                view_date = None
            if view_date is not None:
                rec = TaskCompletion.query.filter_by(
                    task_id=task_id, completed_date=view_date
                ).first()
                if completed and not rec:
                    db.session.add(TaskCompletion(task_id=task_id, completed_date=view_date))
                elif not completed and rec:
                    db.session.delete(rec)
                response_completed_override = completed
        else:
            task.completed = completed
    if 'due_date' in data:
        val = data['due_date']
        if val is None or val == '':
            task.due_date = None
        else:
            try:
                task.due_date = datetime.strptime(val, '%Y-%m-%d').date()
            except (ValueError, TypeError):
                pass
    if 'recurrence' in data and data['recurrence'] in RECURRENCE_CHOICES:
        task.recurrence = data['recurrence']
    db.session.commit()
    return jsonify(task.to_dict(completed_override=response_completed_override))


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    task = Task.query.get_or_404(task_id)
    data = request.get_json(silent=True) or {}
    req_user_code = (data.get('user_code') or '').strip() if isinstance(data, dict) else ''
    if req_user_code and task.user_code != req_user_code:
        return jsonify({'error': 'not found'}), 404

    TaskCompletion.query.filter_by(task_id=task_id).delete(synchronize_session=False)
    db.session.delete(task)
    db.session.commit()
    return '', 204


@app.route('/api/tasks/batch-delete', methods=['POST'])
def batch_delete():
    data = request.get_json() or {}
    ids = data.get('ids', [])
    user_code = (data.get('user_code') or '').strip()
    if not ids:
        return jsonify({'error': '请选择要删除的任务'}), 400

    # 只删除当前识别码下的任务
    tasks = Task.query.filter(Task.id.in_(ids))
    if user_code:
        tasks = tasks.filter_by(user_code=user_code)
    task_ids = [t.id for t in tasks.all()]
    if not task_ids:
        return '', 204

    TaskCompletion.query.filter(TaskCompletion.task_id.in_(task_ids)).delete(synchronize_session=False)
    Task.query.filter(Task.id.in_(task_ids)).delete(synchronize_session=False)
    db.session.commit()
    return '', 204


@app.route('/api/tasks/clear-completed', methods=['POST'])
def clear_completed():
    data = request.get_json() or {}
    user_code = (data.get('user_code') or '').strip()
    date_str = data.get('view_date') or data.get('date')
    if date_str:
        try:
            d = datetime.strptime(date_str, '%Y-%m-%d').date()
            q = TaskCompletion.query.filter_by(completed_date=d)
            if user_code:
                # 先找出该 user_code 的任务，再按任务 id 限制
                user_task_ids = [
                    t.id for t in Task.query.filter_by(user_code=user_code).all()
                ]
                if user_task_ids:
                    q = q.filter(TaskCompletion.task_id.in_(user_task_ids))
                else:
                    q = q.filter(False)
            q.delete(synchronize_session=False)
        except (ValueError, TypeError):
            pass
    # 非重复任务：只清除当前识别码下已完成的
    q_tasks = Task.query.filter(Task.recurrence == 'none', Task.completed == True)
    if user_code:
        q_tasks = q_tasks.filter_by(user_code=user_code)
    q_tasks.delete(synchronize_session=False)
    db.session.commit()
    return '', 204


@app.route('/api/stats/daily', methods=['GET'])
def daily_stats():
    """按月统计每天完成的任务数量（日历用），按 user_code 隔离。"""
    user_code = (request.args.get('user_code') or '').strip()
    if not user_code:
        return jsonify({'error': '缺少识别码'}), 400

    month_str = request.args.get('month')  # 格式：YYYY-MM
    today = datetime.today().date()
    first_day: date
    if month_str:
        try:
            year, month = map(int, month_str.split('-'))
            first_day = date(year, month, 1)
        except ValueError:
            first_day = today.replace(day=1)
    else:
        first_day = today.replace(day=1)

    _, days_in_month = calendar.monthrange(first_day.year, first_day.month)
    last_day = date(first_day.year, first_day.month, days_in_month)

    # 初始化每天为 0
    completed_counts = {
        date(first_day.year, first_day.month, d): 0
        for d in range(1, days_in_month + 1)
    }

    # 非重复任务：认为在 “due_date 或创建日期” 那天完成一次
    non_rec_tasks = Task.query.filter_by(
        user_code=user_code, recurrence='none', completed=True
    ).all()
    for t in non_rec_tasks:
        if t.due_date:
            eff = t.due_date
        else:
            eff = t.created_at.date() if t.created_at else None
        if eff and first_day <= eff <= last_day:
            completed_counts[eff] = completed_counts.get(eff, 0) + 1

    # 重复任务：用 TaskCompletion 里的 completed_date 统计
    rec_completions = (
        TaskCompletion.query.join(Task, Task.id == TaskCompletion.task_id)
        .filter(
            Task.user_code == user_code,
            TaskCompletion.completed_date >= first_day,
            TaskCompletion.completed_date <= last_day,
        )
        .all()
    )
    for c in rec_completions:
        d = c.completed_date
        if first_day <= d <= last_day:
            completed_counts[d] = completed_counts.get(d, 0) + 1

    # 计算每天“应该出现的任务总数”（完成 + 未完成）
    all_tasks = Task.query.filter_by(user_code=user_code).all()
    days = []
    for d in sorted(completed_counts.keys()):
        total_for_day = 0
        for t in all_tasks:
            if task_applies_on_date(t, d):
                total_for_day += 1
        completed_for_day = completed_counts.get(d, 0)
        unfinished_for_day = max(total_for_day - completed_for_day, 0)
        days.append(
            {
                'date': d.isoformat(),
                'completed_count': completed_for_day,
                'unfinished_count': unfinished_for_day,
                'total_count': total_for_day,
            }
        )
    return jsonify({'month': first_day.strftime('%Y-%m'), 'days': days})


if __name__ == '__main__':
    app.run(debug=True, port=5000)

import { IPC } from '@shared/contracts/channels';
import { fail, ok } from '@shared/contracts/result';
import {
  taskBulkInput,
  taskCreateInput,
  taskGetInput,
  taskIdsInput,
  taskQueryInput,
  taskReorderInput,
  taskUpdateInput,
} from '@shared/contracts/task';

import { notifyTasksChanged } from '../../services/task-events';
import {
  bulkTasks,
  createTaskFromInput,
  deleteTasks,
  listTasks,
  readTask,
  reorderTaskGroup,
  restoreTasks,
  undoLastWrite,
  updateTaskFromPatch,
} from '../../services/tasks';
import { invalid } from '../validate';

/** A channel paired with the function that answers it, as `register.ts` expects. */
export interface ChannelHandler {
  channel: string;
  run: (payload: unknown) => unknown;
}

/**
 * The task domain's channels (docs/ARCHITECTURE.md §6.1).
 *
 * Handlers come back as a list so the single registrator keeps its job — payload
 * validation, the exception guard, the value-shaped result — while the domain
 * itself stays out of it. Each handler opens with a `safeParse`, and every write
 * ends in exactly one `notifyTasksChanged`, which is the only place the panel and
 * the marker learn that something changed (M02 §5).
 */
export function taskChannelHandlers(): ChannelHandler[] {
  return [
    {
      channel: IPC.task.query,
      run: (payload) => {
        // An absent payload is a valid query: it asks for the default view.
        const parsed = taskQueryInput.safeParse(payload ?? {});
        if (!parsed.success) return invalid(IPC.task.query, parsed.error.issues);
        return ok(listTasks(parsed.data));
      },
    },
    {
      channel: IPC.task.get,
      run: (payload) => {
        const parsed = taskGetInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.get, parsed.error.issues);
        // A missing row is `null`, not an error: the detail re-reads after every
        // change, and by then the task may be in the recycle bin or gone.
        return ok(readTask(parsed.data.id));
      },
    },
    {
      channel: IPC.task.create,
      run: (payload) => {
        const parsed = taskCreateInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.create, parsed.error.issues);
        const { task, change } = createTaskFromInput(parsed.data);
        notifyTasksChanged(change);
        return ok(task);
      },
    },
    {
      channel: IPC.task.update,
      run: (payload) => {
        const parsed = taskUpdateInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.update, parsed.error.issues);
        const { task, change } = updateTaskFromPatch(parsed.data.id, parsed.data.patch);
        // An unknown id writes nothing, so there is nothing to announce either.
        if (task === null) return fail('NOT_FOUND', `no task with id ${parsed.data.id}`);
        notifyTasksChanged(change);
        return ok(task);
      },
    },
    {
      channel: IPC.task.delete,
      run: (payload) => {
        const parsed = taskIdsInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.delete, parsed.error.issues);
        const { affected, change } = deleteTasks(parsed.data.ids);
        // Every id may already have been in the bin; only a real write notifies.
        if (affected > 0) notifyTasksChanged(change);
        return ok({ affected });
      },
    },
    {
      channel: IPC.task.restore,
      run: (payload) => {
        const parsed = taskIdsInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.restore, parsed.error.issues);
        const { affected, change } = restoreTasks(parsed.data.ids);
        if (affected > 0) notifyTasksChanged(change);
        return ok({ affected });
      },
    },
    {
      channel: IPC.task.reorder,
      run: (payload) => {
        const parsed = taskReorderInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.reorder, parsed.error.issues);
        const { affected, change } = reorderTaskGroup(parsed.data.scope, parsed.data.ids);
        if (affected > 0) notifyTasksChanged(change);
        return ok({ affected });
      },
    },
    {
      channel: IPC.task.bulk,
      run: (payload) => {
        const parsed = taskBulkInput.safeParse(payload);
        if (!parsed.success) return invalid(IPC.task.bulk, parsed.error.issues);
        // The whole selection is one write here, so it is also one notification
        // and one entry on the undo stack — which is the point of the channel.
        const { affected, change } = bulkTasks(parsed.data);
        if (affected > 0) notifyTasksChanged(change);
        return ok({ affected });
      },
    },
    {
      channel: IPC.task.undo,
      run: () => {
        const change = undoLastWrite();
        // An empty stack answers `null` rather than an error: pressing the
        // shortcut one time too many is a no-op, not a failure (M02 D7).
        if (change === null) return ok(null);
        notifyTasksChanged(change);
        return ok({ ids: change.ids });
      },
    },
  ];
}

/**
 * Command Room — Hervald three-column layout.
 *
 * Renders the full Command Room with SessionsColumn, CenterColumn, and TeamColumn.
 * The legacy cron-task view is preserved at CommandRoomLegacyPage for rollback.
 */
import { CommandRoom } from '@/surfaces/hervald/CommandRoom'

export default function CommandRoomPage() {
  return <CommandRoom />
}

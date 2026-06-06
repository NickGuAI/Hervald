import {
  COMMAND_ROOM_ROUTE_METADATA,
  type CommandRoomRouteMetadata,
} from '@modules/command-room/route-metadata'
export {
  MOBILE_SHELL_BOTTOM_PADDING_CLASS,
  MOBILE_SHELL_FLOATING_BOTTOM_OFFSET_CLASS,
} from '@/styles/mobile-shell'

export function isImmersiveMobileChatRoute(
  pathname: string,
  searchParams: URLSearchParams,
  metadata: CommandRoomRouteMetadata = COMMAND_ROOM_ROUTE_METADATA,
): boolean {
  const commanderParam = searchParams.get(metadata.launch.commanderParam)?.trim() ?? ''
  const panelParam = searchParams.get(metadata.globalCommander.panelParam)?.trim() ?? ''

  return pathname === metadata.launch.path
    && commanderParam.length > 0
    && commanderParam !== metadata.globalCommander.commanderValue
    && (panelParam.length === 0 || panelParam === 'chat')
}

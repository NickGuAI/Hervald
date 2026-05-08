export const MOBILE_SHELL_BOTTOM_PADDING_CLASS =
  'pb-[calc(4rem+env(safe-area-inset-bottom,0px))]'

export function isImmersiveMobileChatRoute(
  pathname: string,
  searchParams: URLSearchParams,
): boolean {
  const commanderParam = searchParams.get('commander')?.trim() ?? ''
  const panelParam = searchParams.get('panel')?.trim() ?? ''

  return pathname === '/command-room'
    && commanderParam.length > 0
    && commanderParam !== 'global'
    && (panelParam.length === 0 || panelParam === 'chat')
}

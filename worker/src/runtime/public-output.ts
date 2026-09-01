/**
 * Keep hosting and agent-runtime implementation details out of customer-facing
 * text. The model still works with the real paths internally; only the copy
 * crossing a public delivery boundary is rewritten.
 */
export function sanitizePublicRuntimeText(text: string): string {
  const pathBoundary = '(?=\\/|[\\s"\'`\\)\\]}>:,;.!?]|$)';

  return text
    .replace(new RegExp(`\\/home\\/sprite\\/\\.hermes${pathBoundary}`, 'gi'), '/workspace/.agent')
    .replace(new RegExp(`\\/sprite\\/\\.hermes${pathBoundary}`, 'gi'), '/workspace/.agent')
    .replace(new RegExp(`\\/home\\/sprite\\/aisar${pathBoundary}`, 'gi'), '/workspace')
    .replace(new RegExp(`\\/home\\/sprite${pathBoundary}`, 'gi'), '/workspace')
    .replace(new RegExp(`\\/sprite${pathBoundary}`, 'gi'), '/workspace')
    .replace(new RegExp(`\\/\\.sprite${pathBoundary}`, 'gi'), '/workspace/.runtime')
    .replace(/(^|[\s("'`])~?\/\.hermes(?=\/|[\s"'`)\]}>:,;.!?]|$)/gim, '$1/workspace/.agent')
    .replace(
      /\bHermes(?=\s+(?:agent|runtime|gateway|API(?: server)?|configuration|config|home|installation)\b)/gi,
      'Jentera',
    )
    .replace(
      /\b(?:Fly\.io\s+)?Sprites?(?=\s+(?:runtime|VM|machine|environment|workspace|container)\b)/gi,
      'Jentera',
    );
}

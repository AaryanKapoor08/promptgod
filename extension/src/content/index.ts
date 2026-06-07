// PromptGod content script — injected into ChatGPT, Claude, Gemini, and Perplexity

import type { PlatformAdapter } from './adapters/types'
import { ChatGPTAdapter } from './adapters/chatgpt'
import { ClaudeAdapter } from './adapters/claude'
import { GeminiAdapter } from './adapters/gemini'
import { PerplexityAdapter } from './adapters/perplexity'
import { injectTriggerButton, observeComposer, registerShortcut, showFirstRunTooltip } from './ui/trigger-button'
import { showToast } from './ui/toast'

const adapters: PlatformAdapter[] = [
  new ChatGPTAdapter(),
  new ClaudeAdapter(),
  new GeminiAdapter(),
  new PerplexityAdapter(),
]

const adapter = adapters.find((a) => a.matches()) ?? null

if (adapter) {
  const platform = adapter.getPlatform()
  console.info({ platform }, '[PromptGod] Content script loaded')

  // The keyboard shortcut and the re-injection observer don't depend on the
  // composer existing yet, so wire them up immediately. Installing the observer
  // up front is what makes slow-hydrating platforms (notably Gemini) reliable:
  // if the composer appears later than our active poll window, the observer
  // still catches the mutation and injects — no manual page refresh required.
  registerShortcut(adapter)
  observeComposer(adapter)

  let tooltipShown = false

  // Actively poll for injection while the platform hydrates. Once the button is
  // in place we stop polling; the observer above keeps it injected across SPA
  // navigations and composer re-renders.
  function waitForInputAndInject(attempt: number): void {
    const injected = injectTriggerButton(adapter!)

    if (injected) {
      if (!tooltipShown) {
        tooltipShown = true
        showFirstRunTooltip()
      }
      return
    }

    if (attempt < 60) {
      if (attempt % 10 === 0) {
        console.info({ attempt, platform }, '[PromptGod] Composer not ready, retrying...')
      }
      setTimeout(() => waitForInputAndInject(attempt + 1), 500)
      return
    }

    // Active polling exhausted (~30s). The observer remains armed, so the button
    // will still appear if the composer shows up later.
    console.info(
      { platform },
      '[PromptGod] Composer not found after polling; observer still active'
    )
    showToast({
      message: 'PromptGod is waiting for the page to finish loading…',
      variant: 'info',
      duration: 6000,
    })
  }

  setTimeout(() => waitForInputAndInject(1), 300)
} else {
  console.info('[PromptGod] Content script loaded on unrecognized platform')
}

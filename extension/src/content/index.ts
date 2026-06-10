// PromptGod content script — injected into ChatGPT, Claude, Gemini, and Perplexity

import type { PlatformAdapter } from './adapters/types'
import { ChatGPTAdapter } from './adapters/chatgpt'
import { ClaudeAdapter } from './adapters/claude'
import { GeminiAdapter } from './adapters/gemini'
import { PerplexityAdapter } from './adapters/perplexity'
import { injectTriggerButton, observeComposer, registerShortcut, showFirstRunTooltip } from './ui/trigger-button'

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
    let injected = false
    try {
      injected = injectTriggerButton(adapter!)
    } catch (error) {
      // A transient DOM race (anchor re-parented mid-insert) must not abort the
      // retry chain — that was a cause of Gemini needing a manual refresh.
      console.warn({ cause: error, attempt, platform }, '[PromptGod] Injection attempt threw, retrying')
    }

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

    // Active polling exhausted (~30s). This is expected on pages without a
    // composer (settings, pricing, etc.) — there's nothing to inject into, so
    // we stay silent rather than nagging the user. The observer remains armed,
    // so the button still appears if a composer shows up later (SPA nav).
    console.info(
      { platform },
      '[PromptGod] Composer not found after polling; observer still active'
    )
  }

  // Kick off almost immediately — on a warm load the composer is already there,
  // so there's no reason to sit idle for 300ms before the first attempt.
  setTimeout(() => waitForInputAndInject(1), 50)
} else {
  console.info('[PromptGod] Content script loaded on unrecognized platform')
}

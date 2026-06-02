import { analyzeApiKey, type Provider } from '../lib/provider-policy'
import { PreferenceManager } from '../lib/preferences'

type OptionsProvider = Extract<Provider, 'google' | 'openrouter' | 'groq'>

const PROVIDERS: Record<OptionsProvider, string> = {
  google: 'Google',
  openrouter: 'OpenRouter',
  groq: 'Groq',
}

export async function initApiKeySettings(): Promise<void> {
  const container = document.getElementById('api-keys-container')
  const saveBtn = document.getElementById('save-all-keys')
  if (!container || !(saveBtn instanceof HTMLButtonElement)) return

  const prefs = await PreferenceManager.getPreferences()
  const keys = { ...(prefs.providerApiKeys ?? {}) } as Partial<Record<Provider, string>>

  container.textContent = ''

  for (const [providerId, name] of Object.entries(PROVIDERS) as Array<[OptionsProvider, string]>) {
    const wrapper = document.createElement('div')
    wrapper.className = 'provider-key-wrapper'

    const labelRow = document.createElement('div')
    labelRow.className = 'label-row'

    const label = document.createElement('label')
    label.textContent = name
    label.htmlFor = `api-key-${providerId}`

    const statusIndicator = document.createElement('span')
    statusIndicator.className = 'status-indicator'

    labelRow.append(label, statusIndicator)

    const input = document.createElement('input')
    input.id = `api-key-${providerId}`
    input.type = 'password'
    input.placeholder = `Enter ${name} API key`
    input.className = 'input-field'
    input.dataset.provider = providerId
    input.value = keys[providerId] ?? ''

    input.addEventListener('input', () => {
      const analysis = analyzeApiKey(input.value)
      if (!input.value.trim()) {
        statusIndicator.textContent = ''
        statusIndicator.className = 'status-indicator'
      } else if (analysis.detectedProvider === providerId || !analysis.detectedProvider) {
        statusIndicator.textContent = analysis.recognizedFormat ? 'Format recognized' : 'Will save for selected provider'
        statusIndicator.className = 'status-indicator'
      } else {
        statusIndicator.textContent = 'Key format looks like another provider'
        statusIndicator.className = 'status-indicator status--error'
      }
    })

    wrapper.append(labelRow, input)
    container.appendChild(wrapper)
  }

  saveBtn.addEventListener('click', async () => {
    const nextKeys = { ...keys } as Partial<Record<Provider, string>>
    const inputs = container.querySelectorAll<HTMLInputElement>('input[data-provider]')

    inputs.forEach((input) => {
      const providerId = input.dataset.provider as OptionsProvider | undefined
      if (!providerId) return

      const value = input.value.trim()
      if (value) {
        nextKeys[providerId] = value
      } else {
        delete nextKeys[providerId]
      }
    })

    const preferredProvider: OptionsProvider = nextKeys.google ? 'google' : 'openrouter'
    const apiKey = nextKeys[preferredProvider] ?? ''
    await PreferenceManager.updatePreferences({
      apiKey,
      provider: preferredProvider,
      providerApiKeys: nextKeys,
    })

    window.alert('Settings saved successfully.')
  })
}

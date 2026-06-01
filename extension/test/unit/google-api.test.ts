import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUserMessage, callGoogleAPI, listGoogleModels } from '../../src/lib/llm-client'
import { buildContextUserMessage } from '../../src/lib/gemma-legacy/text-branch'

describe('Google API client helpers', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('filters and normalizes listed models for generation', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['streamGenerateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    }), { status: 200 }))

    const models = await listGoogleModels('AIzaTestKey')

    expect(models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('maps legacy Gemma ids to the current Gemma 4 fallback model', async () => {
    for (const model of ['gemma-3-27b-it', 'gemma-4', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it']) {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Rewritten prompt' }] } }],
      }), { status: 200 }))

      const text = await callGoogleAPI('AIzaTestKey', 'system', 'user', model)

      expect(text).toBe('Rewritten prompt')
      const calledUrl = String(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0])
      expect(calledUrl).toContain('/models/gemma-4-26b-a4b-it:generateContent')
    }
  })

  it('surfaces a 404 model error for provider-policy escalation', async () => {
    mockFetch.mockResolvedValueOnce(new Response('model not found', { status: 404 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'unknown-model')
    ).rejects.toThrow('Google API returned 404')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const firstUrl = String(mockFetch.mock.calls[0][0])
    expect(firstUrl).toContain('/models/unknown-model:generateContent')
  })

  it('surfaces blocked responses when no text is returned', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      promptFeedback: { blockReason: 'SAFETY' },
      candidates: [{ finishReason: 'SAFETY' }],
    }), { status: 200 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')
    ).rejects.toThrow('Google API returned no text output (blocked (SAFETY))')
  })

  it('retries when output is truncated to one word', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Provide' }] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Give me a 4-phase Java learning roadmap with projects.' }] } }],
      }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')

    expect(text).toBe('Give me a 4-phase Java learning roadmap with projects.')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects blocked partial text outputs', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'Provide' }] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'Provide' }] } }],
      }), { status: 200 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')
    ).rejects.toThrow('Google API returned unusable output (finish reason: SAFETY)')
  })

  it('rejects MAX_TOKENS partial text outputs after the retry window', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Give me a roadmap with' }] } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Give me a roadmap with' }] } }],
      }), { status: 200 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')
    ).rejects.toThrow('Google API returned unusable output (finish reason: MAX_TOKENS)')
  })

  it('surfaces malformed Google JSON responses for provider fallback', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not-json', { status: 200 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')
    ).rejects.toThrow('Google API returned malformed JSON response')
  })

  it('uses header auth and disables thinking for Gemini 2.5 Flash rewrites', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Rewritten prompt' }] } }],
    }), { status: 200 }))

    await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemini-2.5-flash')

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'AIzaTestKey',
    })

    const body = JSON.parse(String(init.body))
    expect(body.generationConfig).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
    })
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'system prompt' }],
    })
  })

  it('retries Flash once and then surfaces retryable failures for provider fallback', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(Math, 'random').mockReturnValue(0)
    mockFetch
      .mockResolvedValueOnce(new Response('temporary outage', { status: 502 }))
      .mockResolvedValueOnce(new Response('temporary outage', { status: 502 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')
    ).rejects.toThrow('Google API returned 502')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const secondUrl = String(mockFetch.mock.calls[1][0])
    expect(secondUrl).toContain('/models/gemini-2.5-flash:generateContent')
    expect(infoSpy).toHaveBeenCalledWith({
      provider: 'google',
      model: 'gemini-2.5-flash',
      status: 502,
      attempt: 1,
      maxAttempts: 2,
      delayMs: 300,
    }, '[PromptGod] Google request failed with 5xx; retrying same model after short backoff')
    expect(infoSpy).toHaveBeenCalledWith({
      provider: 'google',
      model: 'gemini-2.5-flash',
      status: 502,
      attempt: 2,
      maxAttempts: 2,
    }, '[PromptGod] Google request attempts exhausted; surfacing failure for provider fallback')
  })

  it('does not retry a daily-quota 429 and surfaces it after a single request', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const dailyQuotaBody = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
      },
    })
    mockFetch.mockResolvedValueOnce(new Response(dailyQuotaBody, { status: 429 }))

    await expect(
      callGoogleAPI('AIzaTestKey', 'system', 'user', 'gemini-2.5-flash')
    ).rejects.toThrow('Google API returned 429')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledWith({
      provider: 'google',
      model: 'gemini-2.5-flash',
      status: 429,
    }, '[PromptGod] Google daily quota exhausted; skipping retry and surfacing for provider fallback')
  })

  it('uses documented Gemma 4 request shape with systemInstruction', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Rewritten prompt' }] } }],
    }), { status: 200 }))

    await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemma-4-26b-a4b-it')

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))

    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'system prompt' }],
    })
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'user prompt' }],
      },
    ])
  })

  it('sanitizes Gemma analysis leakage down to the final prompt', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: '* User Prompt: "how to learn java"\n* Platform: ChatGPT\n* Draft: roadmap\nPrompt: Give me a focused roadmap to learn Java.\n[DIFF: roadmap structure, practical focus]',
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemma-4-26b-a4b-it')

    expect(text).toBe('Give me a focused roadmap to learn Java.\n[DIFF: roadmap structure, practical focus]')
  })

  it('strips Gemma checklist and draft leakage before the final rewritten prompt', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: `* User wants to rewrite a prompt for ChatGPT.
* Input prompt: "i also want to play around with the latest stuff like hermes agent and carrier ops etc etc jepa. can i rather build some sort of personal agent for me? as a resume project, something which does shit for me and helps me out"
* Goal: Transform this rough, informal request into a strong, actionable prompt for an AI to provide a roadmap/guide.
* Technologies mentioned: Hermes agent, Carrier Ops, JEPA (Joint Embedding Predictive Architecture).
* Tone: Informal, enthusiastic, "do shit for me".
* Deliverable: A plan/guide on how to build this.
* Draft 1 (Too formal): Please provide a detailed guide on how to build a personal agent as a resume project.
* Refining for "FULL" intensity and "practical roadmap" rule: The user wants to "play around" and "do shit".
* Rewritten prompt only? Yes.
* Tag? Yes.
* No reasoning/analysis? Yes.
* No first-person brief? Yes.
* Preserve intent/tech? Yes.
* No [NO_CHANGE]? Yes.
Provide a practical, project-based roadmap for building a high-impact personal agent to serve as a standout resume project. The agent should be designed for actual utility, automating personal tasks and providing real-world assistance. Specifically, integrate and leverage Hermes agent, Carrier Ops, and JEPA. Break the guide down into architecture, phased implementation, required tools, and key technical challenges. Keep the approach practical, technical, and focused on buildable outcomes.
[DIFF: practical roadmap, architecture, milestones]`,
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemma-4-26b-a4b-it')

    expect(text).toBe('Provide a practical, project-based roadmap for building a high-impact personal agent to serve as a standout resume project. The agent should be designed for actual utility, automating personal tasks and providing real-world assistance. Specifically, integrate and leverage Hermes agent, Carrier Ops, and JEPA. Break the guide down into architecture, phased implementation, required tools, and key technical challenges. Keep the approach practical, technical, and focused on buildable outcomes.\n[DIFF: practical roadmap, architecture, milestones]')
  })

  it('strips Gemma checklist leakage when the final prompt is glued after the last Yes marker', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: `* Conversation: Ongoing (message #2)
* User's original prompt: "how to learn java"
* Goal: Rewrite "how to learn java" into a stronger prompt for the AI.
* Draft 1 (Too generic): Please provide a comprehensive guide on how to learn Java.
* Draft 2 (Better): Create a practical, project-based roadmap for learning Java.
* Rewritten prompt only? Yes.
* Tag? Yes.
* No explanation? Yes.
* No first-person? Yes.
* Preserve intent? Yes.
* Broad learning prompt -> practical roadmap? Yes.Provide a practical, structured roadmap for learning Java. Focus on a project-based approach rather than just theory. Break the learning path into clear stages, identify the core concepts to master at each step, and suggest specific projects to build to validate understanding. Keep the guidance sharp, actionable, and free of fluff.
[DIFF: roadmap, projects]`,
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemma-4-26b-a4b-it')

    expect(text).toBe('Provide a practical, structured roadmap for learning Java. Focus on a project-based approach rather than just theory. Break the learning path into clear stages, identify the core concepts to master at each step, and suggest specific projects to build to validate understanding. Keep the guidance sharp, actionable, and free of fluff.\n[DIFF: roadmap, projects]')
  })

  it('falls back to a sharpened source prompt when Gemma softens a launch prompt into generic project-brief language', async () => {
    const rawPrompt = 'I will upload the launch brief, meeting notes, a draft customer FAQ, and product screenshots. Please use these documents to create actionable launch preparation materials. Specifically, identify the primary launch risks, any inconsistencies or contradictions within the provided documents, potential customer misunderstandings, and team assumptions that lack evidence. Based on this analysis, provide:\n\n1. A practical launch readiness checklist.\n2. A concise internal risk memo.\n3. A draft customer-facing FAQ that is clear and natural-sounding.\n\nIf the files present conflicting information, please highlight these discrepancies directly. Avoid inventing missing details or masking uncertainty with vague language. Draft a clear summary I can share internally.'
    const userMessage = buildUserMessage(
      rawPrompt,
      'chatgpt',
      { isNewConversation: true, conversationLength: 0 }
    )

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: 'Please analyze the attached launch brief, meeting notes, draft customer FAQ, and product screenshots to proactively identify potential issues. Deliverables include: a launch readiness checklist, an internal risk memo, and a refined customer FAQ. Focus on identifying launch risks, inconsistencies across documents, potential customer confusion, and unsupported team assumptions. Clearly flag any conflicting information found within the files, and provide a concise summary of your findings for internal distribution. Avoid speculation or ambiguous language.\n[DIFF: refined wording, deliverables]',
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', userMessage, 'gemma-4-26b-a4b-it')

    expect(text).toBe(
      'Use the launch brief, meeting notes, a draft customer FAQ, and product screenshots as the source material to create actionable launch preparation materials. Specifically, identify the primary launch risks, any inconsistencies or contradictions within the provided documents, potential customer misunderstandings, and team assumptions that lack evidence. Then produce a practical launch readiness checklist, a concise internal risk memo, and a draft customer-facing FAQ that is clear and natural-sounding. If the files present conflicting information, please highlight these discrepancies directly. Avoid inventing missing details or masking uncertainty with vague language. Draft a clear summary I can share internally.\n[DIFF: refined wording, deliverables]'
    )
  })

  it('uses the same Gemma fallback for text branch rewrite requests', async () => {
    const selectedText = 'I will upload the launch brief, meeting notes, a draft customer FAQ, and product screenshots. Please use these documents to create actionable launch preparation materials. Specifically, identify the primary launch risks, any inconsistencies or contradictions within the provided documents, potential customer misunderstandings, and team assumptions that lack evidence. Based on this analysis, provide:\n\n1. A practical launch readiness checklist.\n2. A concise internal risk memo.\n3. A draft customer-facing FAQ that is clear and natural-sounding.\n\nIf the files present conflicting information, please highlight these discrepancies directly. Avoid inventing missing details or masking uncertainty with vague language. Draft a clear summary I can share internally.'
    const userMessage = buildContextUserMessage(selectedText)

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: 'Please analyze the attached launch brief, meeting notes, draft customer FAQ, and product screenshots to proactively identify potential issues. Deliverables include: a launch readiness checklist, an internal risk memo, and a refined customer FAQ. Focus on identifying launch risks, inconsistencies across documents, potential customer confusion, and unsupported team assumptions. Clearly flag any conflicting information found within the files, and provide a concise summary of your findings for internal distribution. Avoid speculation or ambiguous language.',
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', userMessage, 'gemma-4-26b-a4b-it')

    expect(text).toBe(
      'Use the launch brief, meeting notes, a draft customer FAQ, and product screenshots as the source material to create actionable launch preparation materials. Specifically, identify the primary launch risks, any inconsistencies or contradictions within the provided documents, potential customer misunderstandings, and team assumptions that lack evidence. Then produce a practical launch readiness checklist, a concise internal risk memo, and a draft customer-facing FAQ that is clear and natural-sounding. If the files present conflicting information, please highlight these discrepancies directly. Avoid inventing missing details or masking uncertainty with vague language. Draft a clear summary I can share internally.'
    )
  })

  it('sanitizes Gemini Flash wrapper tags down to the rewritten prompt', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: '<user_query>\nExplain the in-depth process that occurs after a user submits a prompt to ChatGPT, specifically detailing where and how LangChain integrates into this workflow. Focus on the interaction points and the value LangChain adds.\n</user_query>',
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemini-2.5-flash')

    expect(text).toBe('Explain the in-depth process that occurs after a user submits a prompt to ChatGPT, specifically detailing where and how LangChain integrates into this workflow. Focus on the interaction points and the value LangChain adds.')
  })

  it('flattens generic instruction markup from Gemini Flash into plain text', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        finishReason: 'STOP',
        content: {
          parts: [{
            text: '<instruction>\nExplain where LangChain fits into the flow after a user submits a prompt to ChatGPT.\n\nFocus on the following aspects:\n<list>\n<item>The initial processing of the prompt by ChatGPT.</item>\n<item>The typical points of intervention for LangChain within a larger application architecture.</item>\n</list>\n</instruction>',
          }],
        },
      }],
    }), { status: 200 }))

    const text = await callGoogleAPI('AIzaTestKey', 'system prompt', 'user prompt', 'gemini-2.5-flash')

    expect(text).toBe('Explain where LangChain fits into the flow after a user submits a prompt to ChatGPT.\n\nFocus on the following aspects:\n- The initial processing of the prompt by ChatGPT.\n- The typical points of intervention for LangChain within a larger application architecture.')
  })
})

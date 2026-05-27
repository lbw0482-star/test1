import dayjs from "dayjs"
import mock5123089007 from "~mocks/5123089007.json"
import mock4599649006 from "~mocks/4599649006.json"

import type { Education } from "~core/types"

import { executeSequentially, type ExecutableFunction } from "./utils/executor"
import { fillDefaultInputField } from "./utils/input"
import { getLabelText, shouldSkipLabel } from "./utils"
import { findMatchOption } from "./utils/select"

// 要求
/**
 * 1. 能够爬取到页面上所有的表单项
 *  - 整理表单项的label 和 表单的类型 type,如果是select 类型，获取到所有选项
 *  - 基础表单的类型包括文本框、下拉框
 *  - form list（education 信息（））包含基础的表单类型
 *  - 将所有的信息打印在console里
 *
 * 2. 能够将提供的 mock 的数据填入到表单中
 *
 * 3. 填充完成后统计完成情况。
 */

type TRule = { label: string; type: string; options?: string[] }
type TMockID = "5123089007" | "4599649006" | null
const MOCK_512 = "5123089007"
const MOCK_459 = "4599649006"
export class GreenhouseAutoFill {
  formRules: TRule[] = []
  private answerMap = new Map<string, string | string[]>()
  private educationInfo: Education[] = []
  private currentValue: string | string[] | null = null
  private filledFields = new Set<string>()
  private unfilledFields = new Set<string>()
  private totalFields = new Set<string>()

  private normalizeLabel(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]/g, "")
  }

  private detectMockIDFromURL(url: URL): TMockID {
    const token = url.searchParams.get("token")
    const ghJid = url.searchParams.get("gh_jid")
    const pathname = url.pathname
    const fullURL = url.href

    if (token === MOCK_512 || fullURL.includes(`token=${MOCK_512}`)) {
      return MOCK_512
    }

    if (
      ghJid === MOCK_459 ||
      pathname.includes(`/jobs/${MOCK_459}`) ||
      fullURL.includes(`gh_jid=${MOCK_459}`)
    ) {
      return MOCK_459
    }

    return null
  }

  private getMockIDByURL(): TMockID {
    const currentMockID = this.detectMockIDFromURL(new URL(window.location.href))
    if (currentMockID) return currentMockID

    try {
      if (window.top && window.top !== window) {
        const topMockID = this.detectMockIDFromURL(new URL(window.top.location.href))
        if (topMockID) return topMockID
      }
    } catch (error) {
      // cross-origin iframe may block top.location
    }

    const pageText = document.body?.textContent || ""
    if (pageText.includes(MOCK_512)) return MOCK_512
    if (pageText.includes(MOCK_459)) return MOCK_459

    return null
  }

  private buildAnswerMap() {
    this.answerMap.clear()
    this.educationInfo = []

    const mockID = this.getMockIDByURL()
    if (!mockID) {
      console.warn(
        "[GreenhouseAutoFill] 未命中 README 指定链接，不加载默认 mock。当前URL:",
        window.location.href
      )
      return
    }

    const mockData = mockID === MOCK_512 ? (mock5123089007 as any[]) : (mock4599649006 as any[])

    console.info(`[GreenhouseAutoFill] 当前命中 mock: mocks/${mockID}.json`)
    for (const row of mockData) {
      if (row?.name) {
        this.answerMap.set(this.normalizeLabel(row.name), row.value)
      }

      if (row?.Education && Array.isArray(row.Education)) {
        this.educationInfo = row.Education
      }
    }
  }

  private getAnswerByLabel(label: string): string | string[] | null {
    const normalized = this.normalizeLabel(label)
    if (this.answerMap.has(normalized)) {
      return this.answerMap.get(normalized) ?? null
    }

    for (const [key, value] of this.answerMap.entries()) {
      if (key.includes(normalized) || normalized.includes(key)) {
        return value
      }
    }

    return null
  }

  private getElementLabel(element: Element): string {
    const htmlElement = element as HTMLElement
    const directAria = htmlElement.getAttribute("aria-label")?.trim()
    if (directAria) return directAria

    const idAttr = htmlElement.getAttribute("id")
    if (idAttr) {
      const forLabel = document.querySelector(`label[for="${idAttr}"]`)
      if (forLabel) {
        const text = getLabelText(forLabel)
        if (text) return text
      }
    }

    const wrapperLabel = element.closest("label")
    if (wrapperLabel) {
      const text = getLabelText(wrapperLabel)
      if (text) return text
    }

    const fieldContainer = element.closest(
      ".field, .question, .application-field, li, .form-group, div"
    )
    if (fieldContainer) {
      const labelEl = fieldContainer.querySelector("label")
      if (labelEl) {
        const text = getLabelText(labelEl)
        if (text) return text
      }
      const legendEl = fieldContainer.querySelector("legend")
      const legendText = legendEl?.textContent?.trim()
      if (legendText) return legendText.replace(/[✱*]/g, "").trim()
    }

    const inputElement = element as HTMLInputElement | HTMLTextAreaElement
    const placeholder = inputElement.placeholder?.trim()
    if (placeholder) return placeholder

    const name = htmlElement.getAttribute("name")?.trim()
    if (name) return name

    return ""
  }

  private getElementByLabel(label: string, type: string): Element | null {
    const normalized = this.normalizeLabel(label)
    const candidateSelector =
      type === "select"
        ? "select"
        : "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file']), textarea"
    const candidates = Array.from(document.querySelectorAll(candidateSelector))

    for (const candidate of candidates) {
      const text = this.getElementLabel(candidate)
      if (!text) continue
      const normalizedText = this.normalizeLabel(text)
      if (!normalizedText) continue

      if (
        normalizedText === normalized ||
        normalizedText.includes(normalized) ||
        normalized.includes(normalizedText)
      ) {
        return candidate
      }
    }

    const labels = Array.from(document.querySelectorAll("label"))

    for (const labelEl of labels) {
      const text = getLabelText(labelEl)
      if (!text) continue
      const normalizedText = this.normalizeLabel(text)
      if (!normalizedText) continue

      if (
        normalizedText === normalized ||
        normalizedText.includes(normalized) ||
        normalized.includes(normalizedText)
      ) {
        const htmlLabel = labelEl as HTMLLabelElement
        const forAttr = htmlLabel.getAttribute("for")
        if (forAttr) {
          const target = document.getElementById(forAttr)
          if (target) return target
        }

        let container: Element | null = labelEl
        for (let i = 0; i < 5 && container; i++) {
          if (type === "select") {
            const select = container.querySelector("select")
            if (select) return select
          } else {
            const input = container.querySelector(
              "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea"
            )
            if (input) return input
          }
          container = container.parentElement
        }

        const fallbackContainer = labelEl.closest(".field, .question, li, div") || labelEl
        if (type === "select") {
          const select = fallbackContainer.querySelector("select")
          if (select) return select
        } else {
          const input = fallbackContainer.querySelector(
            "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea"
          )
          if (input) return input
        }
      }
    }

    return null
  }

  private tryFillChoiceField(label: string, value: string): boolean {
    const labels = Array.from(document.querySelectorAll("label"))
    const normalized = this.normalizeLabel(label)
    const normalizedValue = this.normalizeLabel(value)

    for (const labelEl of labels) {
      const text = getLabelText(labelEl)
      if (!text) continue
      const normalizedText = this.normalizeLabel(text)

      if (
        !(
          normalizedText === normalized ||
          normalizedText.includes(normalized) ||
          normalized.includes(normalizedText)
        )
      ) {
        continue
      }

      let container: Element | null = labelEl
      for (let i = 0; i < 6 && container; i++) {
        const optionLabels = Array.from(container.querySelectorAll("label"))
        for (const optionLabel of optionLabels) {
          const optionText = getLabelText(optionLabel)
          if (!optionText) continue
          const normalizedOption = this.normalizeLabel(optionText)
          if (
            normalizedOption === normalizedValue ||
            normalizedOption.includes(normalizedValue) ||
            normalizedValue.includes(normalizedOption)
          ) {
            ;(optionLabel as HTMLElement).click()

            const forAttr = (optionLabel as HTMLLabelElement).getAttribute("for")
            if (forAttr) {
              const input = document.getElementById(forAttr) as
                | HTMLInputElement
                | null
              if (input) {
                input.checked = true
                input.dispatchEvent(
                  new Event("change", { bubbles: true, cancelable: true })
                )
              }
            }

            return true
          }
        }
        container = container.parentElement
      }
    }

    return false
  }

  extractFields(): TRule[] {
    const result: TRule[] = []
    const dedup = new Set<string>()
    const formRoot =
      document.querySelector("form#application_form, form[action*='/applications']") ||
      document.body

    const textInputs = Array.from(
      formRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file']), textarea"
      )
    )
    textInputs.forEach((inputEl) => {
      const labelText = this.getElementLabel(inputEl)
      if (!labelText) return
      const key = `${this.normalizeLabel(labelText)}-input`
      if (!dedup.has(key)) {
        dedup.add(key)
        result.push({ label: labelText, type: "input" })
      }
    })

    const selects = Array.from(formRoot.querySelectorAll<HTMLSelectElement>("select"))
    selects.forEach((selectEl) => {
      const labelText = this.getElementLabel(selectEl)
      if (!labelText) return
      const options = Array.from(selectEl.querySelectorAll("option"))
        .map((option) => option.textContent?.trim() || "")
        .filter(Boolean)
      const key = `${this.normalizeLabel(labelText)}-select`
      if (!dedup.has(key)) {
        dedup.add(key)
        result.push({ label: labelText, type: "select", options })
      }
    })

    const questionLabels = Array.from(formRoot.querySelectorAll("label"))
      .filter((labelEl) => !shouldSkipLabel(labelEl))
      .filter((labelEl) =>
        Boolean(
          labelEl
            .closest(".field, .question, li, div")
            ?.querySelector("input[type='radio'], input[type='checkbox']")
        )
      )
    questionLabels.forEach((labelEl) => {
      const labelText = getLabelText(labelEl)
      if (!labelText) return
      const key = `${this.normalizeLabel(labelText)}-input`
      if (!dedup.has(key)) {
        dedup.add(key)
        result.push({ label: labelText, type: "input" })
      }
    })

    const pageText = formRoot.textContent?.toLowerCase() || ""
    const hasEducationInputs = Boolean(
      formRoot.querySelector(
        "input[name*='school' i], input[id*='school' i], input[name*='degree' i], input[id*='degree' i], input[name*='discipline' i], input[id*='discipline' i]"
      )
    )
    if (pageText.includes("education") || hasEducationInputs) {
      result.push({ label: "Education", type: "education" })
    }

    this.formRules = result
    console.info("[GreenhouseAutoFill] extract fields:", result)
    return result
  }

  async fillForm() {
    this.filledFields.clear()
    this.unfilledFields.clear()
    this.totalFields.clear()
    this.extractFields()
    this.buildAnswerMap()
    console.info(
      `[GreenhouseAutoFill] fields=${this.formRules.length}, answers=${this.answerMap.size}, education=${this.educationInfo.length}`
    )

    const sequenceFuncCollector: ExecutableFunction[] = []
    for (let rule of this.formRules) {
      const action = this.getFormElementExecutor(rule)
      const actions = (Array.isArray(action) ? action : [action]).filter(Boolean)
      sequenceFuncCollector.push(...actions)
    }

    await executeSequentially(...sequenceFuncCollector)
    this.handleFilledInfo()
  }

  getFormElementExecutor(rule: TRule): ExecutableFunction[] {
    const fieldLabel = `${rule.label}(${rule.type})`
    this.totalFields.add(fieldLabel)

    if (rule.type === "education") {
      if (!this.educationInfo.length) {
        this.unfilledFields.add(fieldLabel)
        return []
      }

      return [
        {
          func: async () => {
            const ok = await this.fillEducation()
            if (ok) {
              this.filledFields.add(fieldLabel)
            } else {
              this.unfilledFields.add(fieldLabel)
            }
          },
          delay: 500
        }
      ]
    }

    const answer = this.getAnswerByLabel(rule.label)
    if (answer === null || answer === undefined || answer === "") {
      this.unfilledFields.add(fieldLabel)
      return []
    }

    const targetElement = this.getElementByLabel(rule.label, rule.type)
    if (!targetElement && Array.isArray(answer)) {
      return [
        {
          func: async () => {
            const ok = this.tryFillChoiceField(rule.label, String(answer[0] ?? ""))
            if (ok) {
              this.filledFields.add(fieldLabel)
            } else {
              this.unfilledFields.add(fieldLabel)
            }
          }
        }
      ]
    }

    if (!targetElement) {
      this.unfilledFields.add(fieldLabel)
      return []
    }

    return [
      {
        func: async () => {
          this.currentValue = answer
          try {
            let ok = false
            if (rule.type === "select") {
              ok = await this.fillSelectField(targetElement as HTMLSelectElement)
            } else {
              ok = await this.fillInputTextField(
                targetElement as HTMLInputElement | HTMLTextAreaElement
              )
            }
            if (ok) {
              this.filledFields.add(fieldLabel)
            } else {
              this.unfilledFields.add(fieldLabel)
            }
          } catch (error) {
            console.error("[GreenhouseAutoFill] fill field failed:", rule.label, error)
            this.unfilledFields.add(fieldLabel)
          } finally {
            this.currentValue = null
          }
        }
      }
    ]
  }

  handleFilledInfo() {
    const filled = Array.from(this.filledFields)
    const total = Array.from(this.totalFields)
    const unfilled = total.filter((name) => !this.filledFields.has(name))

    console.info(
      `[GreenhouseAutoFill] 完成: ${filled.length}/${total.length}, 未填充: ${unfilled.length}`
    )
    console.info("[GreenhouseAutoFill] 成功字段:", filled)
    console.info("[GreenhouseAutoFill] 未填充字段:", unfilled)
  }

  // 填充时需要的一些基础方法
  fillInputTextField = async (
    element: HTMLInputElement | HTMLTextAreaElement
  ): Promise<boolean> => {
    if (!element || this.currentValue === null || this.currentValue === undefined) return false
    const value = Array.isArray(this.currentValue)
      ? String(this.currentValue[0] ?? "")
      : String(this.currentValue)
    if (!value) return false
    await fillDefaultInputField(element, value)
    return true
  }

  fillSelectField = async (element: HTMLSelectElement): Promise<boolean> => {
    if (!element || this.currentValue === null || this.currentValue === undefined) return false

    const target = Array.isArray(this.currentValue)
      ? String(this.currentValue[0] ?? "")
      : String(this.currentValue)
    if (!target) return false

    const optionElements = Array.from(element.options).filter(
      (option) => option.value !== ""
    ) as unknown as HTMLElement[]

    const matched = findMatchOption(optionElements, target)
    const matchedValue = (matched as HTMLOptionElement | null)?.value
    if (!matchedValue) return false

    element.value = matchedValue
    element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
    return true
  }

  async fillEducation(): Promise<boolean> {
    if (!this.educationInfo.length) return false

    const schoolInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input[name*='school' i], input[id*='school' i], textarea[name*='school' i]"
      )
    )
    const degreeInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input[name*='degree' i], input[id*='degree' i], textarea[name*='degree' i]"
      )
    )
    const disciplineInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input[name*='discipline' i], input[id*='discipline' i], input[name*='major' i], input[id*='major' i]"
      )
    )
    const startInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input[name*='start' i], input[id*='start' i]"
      )
    )
    const endInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input[name*='end' i], input[id*='end' i]"
      )
    )

    let filledCount = 0
    for (let i = 0; i < this.educationInfo.length; i++) {
      const edu = this.educationInfo[i]
      const discipline = Array.isArray((edu as any).Discipline)
        ? (edu as any).Discipline[0]
        : (edu as any).Discipline

      if (schoolInputs[i]) {
        await fillDefaultInputField(schoolInputs[i], (edu as any).School || edu.school || "")
        filledCount++
      }
      if (degreeInputs[i]) {
        await fillDefaultInputField(degreeInputs[i], (edu as any).Degree || edu.degree || "")
        filledCount++
      }
      if (disciplineInputs[i]) {
        await fillDefaultInputField(disciplineInputs[i], discipline || edu.discipline || "")
        filledCount++
      }
      if (startInputs[i]) {
        await fillDefaultInputField(
          startInputs[i],
          dayjs((edu as any).Start || edu.start).format("MM/YYYY")
        )
        filledCount++
      }
      if (endInputs[i]) {
        await fillDefaultInputField(
          endInputs[i],
          dayjs((edu as any).End || edu.end).format("MM/YYYY")
        )
        filledCount++
      }
    }

    return filledCount > 0
  }
}

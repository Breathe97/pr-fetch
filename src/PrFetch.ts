interface PrFetchOption {
  timeout?: number
  check?: boolean
}

export class PrFetch {
  #option: PrFetchOption = {
    timeout: 5 * 1000,
    check: false
  }
  #abortController: AbortController | null = null // 实例变量：统一管理当前请求的中止
  #activeRequest: Promise<any> | null = null // 跟踪当前活跃请求（避免重复）

  constructor(option: PrFetchOption = {}) {
    this.#option = { ...this.#option, ...option }
  }

  /**
   * 检查资源可用性（HEAD 请求）—— 用实例变量控制器
   */
  check = (input: string | URL | Request, init?: RequestInit) => {
    return new Promise<{ status: 'successed' | 'failed' | 'error' | 'timeout' | 'stopped'; reason: string }>((resolve) => {
      // 统一用resolve返回所有状态（避免reject丢失）
      this.stop() // 中止上一个请求（关键：确保单请求串行）
      this.#abortController = new AbortController()
      const { signal } = this.#abortController
      const timeout = this.#option.timeout

      // 超时控制器（避免重复触发）
      let isAborted = false
      const timer = timeout
        ? setTimeout(() => {
            if (isAborted) return
            isAborted = true
            this.#abortController?.abort(`Timeout (${timeout}ms)`)
          }, timeout)
        : null

      // 发起HEAD请求（用实例signal）
      this.#activeRequest = fetch(input, {
        ...init,
        method: 'HEAD',
        signal,
        credentials: init?.credentials ?? 'same-origin'
      })
        .then((res) => {
          clearTimeout(timer!)
          resolve({
            status: res.status === 200 ? 'successed' : 'failed',
            reason: res.status === 200 ? '' : `HTTP ${res.status}`
          })
        })
        .catch((err) => {
          clearTimeout(timer!)
          if (err.name === 'AbortError') {
            // 区分“超时”和“主动停止”
            const reason = (signal as any).reason || 'Actively stopped'
            resolve({
              status: reason.includes('Timeout') ? 'timeout' : 'stopped',
              reason
            })
          } else {
            resolve({ status: 'error', reason: err.message })
          }
        })
        .finally(() => {
          this.#activeRequest = null // 请求结束，释放引用
          this.#abortController = null // 释放控制器
        })
    })
  }

  /**
   * 发起数据请求（GET/POST 等）—— 用实例变量控制器
   */
  request = (input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      this.stop() // 中止上一个请求（关键：避免多请求冲突）
      this.#abortController = new AbortController()
      const { signal } = this.#abortController

      this.#activeRequest = fetch(input, { ...init, signal })
        .then((res) => {
          resolve(res)
          this.#cleanup() // 成功后清理
        })
        .catch((err) => {
          // 关键：显式传递AbortError（主动停止/超时）
          if (err.name === 'AbortError') {
            const customErr = new Error((signal as any).reason || 'Request stopped')
            customErr.name = 'PrFetchStopError' // 自定义错误类型（便于外部捕获）
            reject(customErr)
          } else {
            reject(err) // 其他错误正常传递
          }
          this.#cleanup() // 失败后清理
        })
    })
  }

  /**
   * 主动停止当前请求—— 强制中止+清理
   */
  stop = () => {
    if (this.#abortController && !this.#abortController.signal.aborted) {
      // 1. 中止请求（传入明确原因）
      this.#abortController.abort('Actively stopped by user')
      // 2. 清理引用（避免重复中止）
      this.#abortController = null
      // 3. 若有活跃请求，标记为已中止（可选）
      if (this.#activeRequest) {
        this.#activeRequest.catch(() => {}) // 吞掉已中止的Promise错误（避免控制台警告）
      }
    }
  }

  /**
   * 私有方法：清理控制器和活跃请求
   */
  #cleanup = () => {
    this.#abortController = null
    this.#activeRequest = null
  }
}

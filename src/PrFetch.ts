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

  constructor(option: PrFetchOption = {}) {
    this.#option = { ...this.#option, ...option }
  }

  /**
   * 检查资源可用性（HEAD 请求）—— 用实例变量控制器
   */
  #check = (input: string | URL | Request, init?: RequestInit) => {
    return new Promise<{ status: 'successed' | 'failed' | 'error' | 'timeout' | 'stopped'; reason: string }>(async (resolve) => {
      this.#abortController = new AbortController()
      const { signal } = this.#abortController
      const timeout = this.#option.timeout

      const timer = setTimeout(() => {
        this.#abortController?.abort(`Timeout (${timeout}ms)`)
      }, timeout)

      // 发起HEAD请求
      await fetch(input, { cache: 'no-store', ...init, method: 'HEAD', signal })
        .then((res) => {
          clearTimeout(timer!)
          resolve({ status: res.status === 200 ? 'successed' : 'failed', reason: res.status === 200 ? '' : `HTTP ${res.status}` })
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
    })
  }

  /**
   * 发起数据请求（GET/POST 等）—— 用实例变量控制器
   */
  request = (input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>(async (resolve, reject) => {
      try {
        this.stop()
        if (this.#option.check) {
          await this.#check(input)
        }

        this.#abortController = new AbortController()
        const { signal } = this.#abortController

        const res = await fetch(input, { cache: 'no-store', ...init, signal })

        resolve(res)
      } catch (error: any) {
        reject(error)
      }
    })
  }

  stop = () => {
    if (this.#abortController?.signal.aborted === false) {
      const err = new Error('Actively stopped.')
      err.name = 'AbortError'
      this.#abortController.abort(err)
    }
  }
}

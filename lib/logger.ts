import { cyan, yellow, red, gray } from 'std/fmt/colors.ts'

export class Logger {
  constructor(private prefix: string) {}

  private timestamp(): string {
    return `[${(new Date()).toISOString().replace('T', ' ').replace('Z', '')}]`
  }

  public log(...items: any): void {
    console.log(gray(`${this.timestamp()} [${this.prefix}]`), ...items)
  }

  public info(...items: any): void {
    console.info(cyan(`${this.timestamp()} [${this.prefix}]`), ...items)
  }

  public warn(...items: any): void {
    console.warn(yellow(`${this.timestamp()} [${this.prefix}]`), ...items)
  }

  public error(...items: any): void {
    console.error(red(`${this.timestamp()} [${this.prefix}]`), ...items)
  }
}

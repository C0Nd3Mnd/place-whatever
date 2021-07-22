export class Logger {
  constructor(private prefix: string) {}

  private timestamp(): string {
    return `[${(new Date()).toISOString().replace('T', ' ').replace('Z', '')}]`
  }

  public log(...items: any): void {
    console.log(this.timestamp(), `[${this.prefix}]`, ...items)
  }

  public info(...items: any): void {
    console.info(this.timestamp(), `[${this.prefix}]`, ...items)
  }

  public warn(...items: any): void {
    console.warn(this.timestamp(), `[${this.prefix}]`, ...items)
  }

  public error(...items: any): void {
    console.error(this.timestamp(), `[${this.prefix}]`, ...items)
  }
}

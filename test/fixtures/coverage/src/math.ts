export function sign(n: number): string {
  if (n > 0) {
    return "positive"
  }
  if (n < 0) {
    return "negative"
  }
  return "zero"
}

export function unused(): number {
  return 42
}

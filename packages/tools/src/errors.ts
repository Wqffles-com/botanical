/** Bad tool arguments or operator config. Safe to show to the model. */
export class ToolInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolInputError";
    this.code = code;
  }
}

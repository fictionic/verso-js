export type BaseConfig = Record<string, unknown>;

export class MiddlewareConfig {
  private config: BaseConfig;

  constructor() {
    this.config = {};
  }

  addValues(config: BaseConfig) {
    Object.assign(this.config, config);
  }

  setValues(config: BaseConfig) {
    const unknownKeys = Object.keys(config).filter(k => !(k in this.config));
    if (unknownKeys.length > 0) {
      throw new Error(`Refusing to set uninitiated config key ${unknownKeys[0]}`);
    }
    this.addValues(config);
  }

  getValue<C extends BaseConfig>(key: keyof C) {
    return (this.config as C)[key];
  }
}

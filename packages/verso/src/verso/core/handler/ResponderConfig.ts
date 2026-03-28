import {getNamespace} from "../../util/requestLocal";

const RLS = getNamespace<{current: ResponderConfig}>();

// export type BaseConfig = Record<string, unknown>;
export type BaseConfig = object; // ^breaks when you define a config with `interface` because typescript

export class ResponderConfig {
  private config: BaseConfig = {};
  constructor() {
    RLS().current = this;
  }

  addValues(config: BaseConfig) {
    this.config = {
      ...this.config,
      ...config,
    };
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

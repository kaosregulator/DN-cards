// Overlay slash-option getters so hub modals / selects can reuse handlers
// written for ChatInputCommandInteraction.options.

import type {
  Attachment,
  Channel,
  ChatInputCommandInteraction,
  User,
} from "discord.js";

export type OptBag = {
  users?: Record<string, User | null | undefined>;
  strings?: Record<string, string | null | undefined>;
  integers?: Record<string, number | null | undefined>;
  booleans?: Record<string, boolean | null | undefined>;
  channels?: Record<string, Channel | null | undefined>;
  attachments?: Record<string, Attachment | null | undefined>;
  subcommand?: string;
};

type OptionsLike = {
  getUser?(name: string, required?: boolean): User | null;
  getString?(name: string, required?: boolean): string | null;
  getInteger?(name: string, required?: boolean): number | null;
  getBoolean?(name: string, required?: boolean): boolean | null;
  getChannel?(name: string, required?: boolean): Channel | null;
  getAttachment?(name: string, required?: boolean): Attachment | null;
  getSubcommand?(required?: boolean): string | null;
};

/** Return type matches ChatInputCommandInteraction so existing handlers accept it. */
export function withOptionValues(
  interaction: object,
  values: OptBag,
): ChatInputCommandInteraction {
  const base = (interaction as { options?: OptionsLike }).options;

  const options = {
    getUser(name: string, required?: boolean): User | null {
      if (Object.prototype.hasOwnProperty.call(values.users ?? {}, name)) {
        const v = values.users![name] ?? null;
        if (v) return v;
        if (required) throw new Error(`Missing user option ${name}`);
        return null;
      }
      try {
        return base?.getUser?.(name, required) ?? null;
      } catch {
        if (required) throw new Error(`Missing user option ${name}`);
        return null;
      }
    },
    getString(name: string, required?: boolean): string | null {
      if (Object.prototype.hasOwnProperty.call(values.strings ?? {}, name)) {
        const v = values.strings![name] ?? null;
        if (v != null) return v;
        if (required) throw new Error(`Missing string option ${name}`);
        return null;
      }
      try {
        return base?.getString?.(name, required) ?? null;
      } catch {
        if (required) throw new Error(`Missing string option ${name}`);
        return null;
      }
    },
    getInteger(name: string, required?: boolean): number | null {
      if (Object.prototype.hasOwnProperty.call(values.integers ?? {}, name)) {
        const v = values.integers![name] ?? null;
        if (v != null) return v;
        if (required) throw new Error(`Missing integer option ${name}`);
        return null;
      }
      try {
        return base?.getInteger?.(name, required) ?? null;
      } catch {
        if (required) throw new Error(`Missing integer option ${name}`);
        return null;
      }
    },
    getBoolean(name: string, required?: boolean): boolean | null {
      if (Object.prototype.hasOwnProperty.call(values.booleans ?? {}, name)) {
        const v = values.booleans![name] ?? null;
        if (v != null) return v;
        if (required) throw new Error(`Missing boolean option ${name}`);
        return null;
      }
      try {
        return base?.getBoolean?.(name, required) ?? null;
      } catch {
        if (required) throw new Error(`Missing boolean option ${name}`);
        return null;
      }
    },
    getChannel(name: string, required?: boolean): Channel | null {
      if (Object.prototype.hasOwnProperty.call(values.channels ?? {}, name)) {
        const v = values.channels![name] ?? null;
        if (v) return v;
        if (required) throw new Error(`Missing channel option ${name}`);
        return null;
      }
      try {
        return (base?.getChannel?.(name, required) as Channel | null) ?? null;
      } catch {
        if (required) throw new Error(`Missing channel option ${name}`);
        return null;
      }
    },
    getAttachment(name: string, required?: boolean): Attachment | null {
      if (Object.prototype.hasOwnProperty.call(values.attachments ?? {}, name)) {
        const v = values.attachments![name] ?? null;
        if (v) return v;
        if (required) throw new Error(`Missing attachment option ${name}`);
        return null;
      }
      try {
        return base?.getAttachment?.(name, required) ?? null;
      } catch {
        if (required) throw new Error(`Missing attachment option ${name}`);
        return null;
      }
    },
    getSubcommand(required?: boolean): string | null {
      if (values.subcommand != null) return values.subcommand;
      try {
        if (!base?.getSubcommand) {
          if (required) throw new Error("Missing subcommand");
          return null;
        }
        return required === undefined
          ? base.getSubcommand(false)
          : base.getSubcommand(required);
      } catch {
        if (required) throw new Error("Missing subcommand");
        return null;
      }
    },
  };

  return new Proxy(interaction, {
    get(target, prop, receiver) {
      if (prop === "options") return options;
      return Reflect.get(target as object, prop, receiver);
    },
  }) as ChatInputCommandInteraction;
}

import { CliAgentDriver } from './cli-agent.mjs';
import { HumanAgentDriver } from './human-agent.mjs';
import { OpenAICompatibleDriver } from './openai-compatible.mjs';
import { SimulatedAgentDriver } from './simulated-agent.mjs';
import { WebhookAgentDriver } from './webhook-agent.mjs';

export class DriverRegistry {
  constructor() {
    this.drivers = new Map();
  }

  register(driver) {
    this.drivers.set(driver.id, driver);
    return this;
  }

  get(id) {
    return this.drivers.get(id) || null;
  }

  list() {
    return [...this.drivers.values()].map((d) => ({
      id: d.id,
      description: d.description
    }));
  }
}

export function createDefaultDriverRegistry(options = {}) {
  return new DriverRegistry()
    .register(new OpenAICompatibleDriver(options.openai || {}))
    .register(new CliAgentDriver())
    .register(new WebhookAgentDriver())
    .register(new HumanAgentDriver())
    .register(new SimulatedAgentDriver());
}

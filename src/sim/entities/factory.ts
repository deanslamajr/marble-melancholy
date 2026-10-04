import type { CompiledEntity } from "../../level/types";
import type { SimContext, SimEntity } from "./base";
import { CatapultEntity } from "./catapult";
import { FunnelEntity } from "./funnel";
import { HammerEntity } from "./hammer";
import { HooverEntity } from "./hoover";
import { MuncherEntity } from "./muncher";
import { PipeEntity } from "./pipe";
import { PlatformEntity } from "./platform";
import { SteelieEntity } from "./steelie";
import { WaveEntity } from "./wave";

export function createEntity(def: CompiledEntity, sim: Pick<SimContext, "terrain">): SimEntity {
  switch (def.type) {
    case "steelie":
      return new SteelieEntity(def, sim);
    case "muncher":
      return new MuncherEntity(def, sim);
    case "hoover":
      return new HooverEntity(def, sim);
    case "hammer":
      return new HammerEntity(def, sim);
    case "catapult":
      return new CatapultEntity(def, sim);
    case "wave":
      return new WaveEntity(def);
    case "platform":
      return new PlatformEntity(def);
    case "pipe":
      return new PipeEntity(def, sim);
    case "funnel":
      return new FunnelEntity(def, sim);
  }
}

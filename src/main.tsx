import { render } from "preact";
import { App } from "./app/App";
import { startRouter } from "./app/router";
import { installTestApi } from "./app/testApi";
import { GameController } from "./game/GameController";
import "./ui/styles.css";

const controller = new GameController();
startRouter();
if (new URLSearchParams(location.search).get("e2e") === "1") installTestApi(controller);
render(<App controller={controller} />, document.getElementById("app")!);
void controller.boot();

import { useController } from "../context";

export function ControlsHelp() {
  const c = useController();
  const s = c.settings.value;
  const p2 = s.p2Keys === "wasd" ? "W A S D" : "I J K L";
  const p1 = s.p2Keys === "wasd" ? "ARROWS" : "ARROWS / W A S D";
  return (
    <table class="controls-help">
      <tbody>
        <tr>
          <th>MOUSE</th>
          <td>click the race to capture, roll like a trackball · ESC pauses</td>
        </tr>
        <tr>
          <th>P1 KEYS</th>
          <td>{p1} · numpad 1–9</td>
        </tr>
        <tr>
          <th>P2 KEYS</th>
          <td>{p2}</td>
        </tr>
        <tr>
          <th>GAMEPAD</th>
          <td>left stick · A confirm · B back · START pause</td>
        </tr>
        <tr>
          <th>TOUCH</th>
          <td>drag on the left side · tap the right side to pause</td>
        </tr>
      </tbody>
    </table>
  );
}

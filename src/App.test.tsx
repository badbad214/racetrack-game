import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the racetrack designer", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: /pen and paper racer/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /design track/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /race/i })).toBeInTheDocument();
});

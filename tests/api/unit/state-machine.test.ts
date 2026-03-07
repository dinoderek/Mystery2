import { describe, it, expect } from "vitest";
import {
    resolveAccusationAction,
    validateTransition,
} from "../../../supabase/functions/_shared/state-machine.ts";

describe("State Machine validateTransition", () => {
    it("allows valid explore actions", () => {
        expect(() => validateTransition("explore", "move")).not.toThrow();
        expect(() => validateTransition("explore", "search")).not.toThrow();
        expect(() => validateTransition("explore", "talk")).not.toThrow();
        expect(() => validateTransition("explore", "accuse")).not.toThrow();
    });

    it("prevents invalid explore actions", () => {
        expect(() => validateTransition("explore", "ask")).toThrow("Invalid action");
        expect(() => validateTransition("explore", "end_talk")).toThrow("Invalid action");
    });

    it("allows valid talk actions", () => {
        expect(() => validateTransition("talk", "ask")).not.toThrow();
        expect(() => validateTransition("talk", "end_talk")).not.toThrow();
    });

    it("prevents invalid talk actions", () => {
        expect(() => validateTransition("talk", "move")).toThrow("Invalid action");
        expect(() => validateTransition("talk", "talk")).toThrow("Invalid action");
    });

    it("allows valid accuse actions", () => {
        expect(() => validateTransition("accuse", "accuse_reasoning")).not.toThrow();
    });

    it("prevents all actions in ended mode", () => {
        expect(() => validateTransition("ended", "move")).toThrow("Invalid action");
        expect(() => validateTransition("ended", "talk")).toThrow("Invalid action");
        expect(() => validateTransition("ended", "ask")).toThrow("Invalid action");
        expect(() => validateTransition("ended", "accuse")).toThrow("Invalid action");
    });

    it("maps accusation actions by mode", () => {
        expect(resolveAccusationAction("explore")).toBe("accuse");
        expect(resolveAccusationAction("accuse")).toBe("accuse_reasoning");
        expect(() => resolveAccusationAction("talk")).toThrow("Invalid accusation");
    });
});

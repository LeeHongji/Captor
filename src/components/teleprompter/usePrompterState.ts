import { useEffect, useState } from "react";
import { INITIAL_PROMPTER_STATE, type PrompterState } from "@/types/teleprompter";

export function usePrompterState() {
	const [state, setState] = useState<PrompterState>(INITIAL_PROMPTER_STATE);
	useEffect(() => {
		const api = window.teleprompterAPI;
		if (!api) return;
		let mounted = true;
		const receive = (next: PrompterState) => {
			if (mounted)
				setState((previous) => (next.sequence >= previous.sequence ? next : previous));
		};
		const unsubscribe = api.onState(receive);
		void api
			.getState()
			.then(receive)
			.catch((error) => {
				if (mounted) setState((previous) => ({ ...previous, error: String(error) }));
			});
		return () => {
			mounted = false;
			unsubscribe();
		};
	}, []);
	return state;
}

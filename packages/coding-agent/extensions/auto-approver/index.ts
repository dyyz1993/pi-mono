import { createAutoApproverProvider, type ExtensionAPI } from "@dyyz1993/pi-coding-agent";

export default function autoApproverExtension(pi: ExtensionAPI): void {
	pi.setName("auto-approver");
	pi.permissions.registerProvider(createAutoApproverProvider());
}

export type Sandbox='read-only'|'workspace-write'|'danger-full-access';
export type Config={workingDirectory:string;sandbox:Sandbox;model:string};
export type ConnectionStatus={state:'not-connected'|'checking'|'ready'|'login-required'|'error';message:string;version?:string;account?:string};
export type ConversationRecord={conversationId:string;threadId:string|null;parentConversationId:string|null;rootNumber:number;branchPath:number[];branchCounter:number;abbr:string;title:string;frontName:string;image:string;pinned:boolean;model:string|null;reasoningEffort:string|null;totalTokens:number|null;uncachedTotalTokens:number|null;lastActivityAt:string|null;lastMessage:string|null;collaborationMode:string|null;createdAt:string;updatedAt:string};
export type ConversationActivity={lastActivityAt?:string;lastMessage?:string};
export type RealtimeSession={streamId:string;seq:number;reset:boolean;threadId:string|null;activeTurnId:string|null;defaultConversationId?:string;activeTurns?:Record<string,string>;conversations?:ConversationRecord[];connectionStatus?:ConnectionStatus};
export type ToolState='running'|'success'|'failed'|'rejected';
export type ToolEvent={id:string;name:string;detail:string;state:ToolState;kind?:string;summary?:string;rawName?:string;arguments?:unknown;command?:string;result?:string};
export type Approval={requestId:string;kind:'command'|'file'|'permissions';title:string;detail:string};
export type ChatEvent=(
 | {type:'connection';status:ConnectionStatus}
 | {type:'turn-started';turnId:string}
 | {type:'assistant-delta';turnId:string;delta:string}
 | {type:'thinking-started';turnId:string;itemId:string}
 | {type:'thinking-delta';turnId:string;itemId?:string;delta:string}
 | {type:'thinking-completed';turnId:string;itemId:string}
 | {type:'tool';turnId:string;tool:ToolEvent}
 | {type:'approval';turnId:string;approval:Approval}
 | {type:'turn-completed';turnId:string;status:string;error?:string}
 | {type:'conversation-updated';conversation:ConversationRecord}
 | {type:'error';message:string}
) & {conversationId?:string};

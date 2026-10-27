export type Sandbox='read-only'|'workspace-write'|'danger-full-access';
export type AppConfig={workingDirectory:string;sandbox:Sandbox;model:string};
export type RpcMessage={jsonrpc:'2.0';id?:number|string;method?:string;params?:unknown;result?:unknown;error?:{code:number;message:string;data?:unknown}};
export type PendingApproval={rpcId:number|string;kind:'command'|'file'|'permissions';params:Record<string,unknown>;turnId:string;conversationId:string};

export type ConversationRecord={
  conversationId:string;
  threadId:string|null;
  parentConversationId:string|null;
  rootNumber:number;
  branchPath:number[];
  branchCounter:number;
  abbr:string;
  title:string;
  frontName:string;
  image:string;
  pinned:boolean;
  model:string|null;
  reasoningEffort:string|null;
  totalTokens:number|null;
  uncachedTotalTokens:number|null;
  lastActivityAt:string|null;
  lastMessage:string|null;
  collaborationMode:string|null;
  createdAt:string;
  updatedAt:string;
};

export type ConversationRuntimeMetadata=Pick<
  ConversationRecord,
  "model"|"reasoningEffort"|"totalTokens"|"uncachedTotalTokens"|"collaborationMode"
>;

export type ConversationThreadBinding={
  threadId:string;
  metadata:Partial<ConversationRuntimeMetadata>;
};

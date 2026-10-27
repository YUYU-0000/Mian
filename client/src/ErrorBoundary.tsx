import{Component,type ErrorInfo,type ReactNode}from'react';
type Props={children:ReactNode};type State={error:Error|null};
export default class ErrorBoundary extends Component<Props,State>{state:State={error:null};static getDerivedStateFromError(error:Error){return{error}}componentDidCatch(error:Error,info:ErrorInfo){console.error('页面渲染错误',error,info.componentStack)}render(){if(this.state.error)return <main role="alert">页面发生错误：{this.state.error.message}</main>;return this.props.children}}

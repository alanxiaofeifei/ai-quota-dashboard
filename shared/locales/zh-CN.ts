export const zh = {
 retiredApi:'官方已停用旧余额接口，当前使用手动记录。', title:'额度总览', eyebrow:'个人额度工作台', headline:'每一份额度，都看得清。', subtitle:'订阅余量与 API 余额，一处掌握。',
 all:'全部',attention:'需关注',api:'API 余额',subscription:'订阅计划',refresh:'刷新 API',add:'添加服务商',light:'切换亮色',dark:'切换深色',
 demo:'演示模式',private:'私人实例',demoNote:'这里是合成演示数据。密钥与数值不会保存，也不会发起供应商请求。',
 need:'项需要关注',providers:'个服务商',apiCount:'项 API',subCount:'项订阅',healthy:'状态正常',warning:'额度偏低',reset_due:'重置待确认',stale:'数据已过期',error_with_cache:'接口异常 · 保留记录',error:'接口异常',unconfigured:'尚未配置',
 remaining:'剩余',unknown:'未知',update:'更新数值',manage:'管理密钥',official:'官方页面',source:'来源',manual:'手动',extension:'扩展',age:'前',now:'刚刚',
 resetDue:'预计已到重置时间，请重新读取确认',reset:'预计重置',noReset:'未提供重置时间',empty:'还没有服务商。添加一个开始记录。',noResults:'此筛选下没有服务商。',
 loading:'正在读取额度…',close:'关闭',cancel:'取消',save:'保存',saveKey:'加密保存',test:'测试并预览',clear:'清除密钥',configured:'已配置',notConfigured:'未配置',
 provider:'服务商',label:'卡片名称',region:'密钥区域',key:'API 密钥',keyNote:'密钥仅通过请求正文提交，以 AES-256-GCM 加密保存。保存后不会回显。',managementNote:'此接口需要 Management Key；普通 Key 请使用 OpenRouter · Key。',
 manualNote:'空白表示未知。请分别录入各计量单位，不做余额换算。',resetInput:'重置时间（如 3d 4h 或带时区的 ISO 时间）',dateInput:'或选择本地日期时间',
 importTitle:'粘贴 ChatGPT 扩展摘要 JSON',importButton:'导入摘要',importNote:'仅接受现有选区扩展的白名单摘要；观测时间保留为读取页面的时间。',preview:'读取预览',saved:'已保存',
 errorMessage:'操作未完成',retry:'重试',cooldown:'冷却中',footer:'数据来自官方 API 或你的主动记录。重置时间到达后，余量仍需重新确认。',
 balance:'余额',weekly_percent:'周额度',five_hour_percent:'5 小时窗口',credits:'独立 Credits',tokens:'Tokens',requests:'请求次数',
 available_balance:'可用余额',voucher_balance:'代金券',cash_balance:'现金',totalBalance:'总余额',chargeBalance:'充值余额',key_remaining:'密钥剩余预算',account_remaining:'账户余额',
 usage:'累计消费',limit:'密钥预算',total_credits:'累计购买',total_usage:'累计消费',balance_CNY:'可用余额',balance_USD:'可用余额',granted_CNY:'赠金',granted_USD:'赠金',topped_up_CNY:'充值',topped_up_USD:'充值',
 freeTier:'免费层',available:'账户可用',unavailable:'账户不可用',daily:'每日',weekly:'每周',monthly:'每月',recurrence:'预算重置周期',lastCheck:'上次检查',
 unauthorized:'密钥无效或权限不足',rate_limited:'上游限流，稍后重试',upstream_error:'上游暂时不可用',invalid_response:'上游响应无效',timeout:'上游请求超时',
 demo_read_only:'演示模式只读，不会保存或发送密钥。',origin_rejected:'请求来源不匹配',json_required:'请求必须是 JSON',body_too_large:'输入超过大小限制',invalid_key:'请输入有效密钥',invalid_input:'输入无效，请检查字段',invalid_reset:'重置时间无效',invalid_json:'JSON 格式无效',invalid_report:'扩展摘要格式无效',older_observation:'摘要早于现有记录',encryption_not_configured:'实例尚未配置加密主密钥',auth_not_configured:'实例尚未配置身份验证',internal_error:'暂时无法读取，请重试',forbidden:'当前账户没有访问权限',not_found:'记录不存在'
};
export type Messages = typeof zh;

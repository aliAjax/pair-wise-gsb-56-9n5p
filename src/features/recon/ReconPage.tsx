import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloudUploadOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import {
  useGetWorkspaceQuery,
  useIngestReceiptMutation,
  useReleaseBatchMutation,
  useSyncBatchDigestsMutation,
  useVoidReceiptMutation,
} from '@/app/api'
import type { BatchFileFreeze, LicenseReceipt, ReconBatch } from '@/types/domain'
import {
  batchStatusColors,
  batchStatusLabels,
  receiptMismatches,
  receiptStatusColors,
  receiptStatusLabels,
} from '@/services/recon'

function errorText(error: unknown): string {
  if (typeof error === 'object' && error && 'error' in error) {
    const value = (error as { error?: unknown }).error
    if (typeof value === 'string') return value
  }
  return '操作失败，请重试'
}

interface ReleaseArgs {
  batchId: string
  expectedRevision: number
  operator: string
  simulateFailure?: boolean
}

export function ReconPage() {
  const [searchParams] = useSearchParams()
  const { data, isLoading } = useGetWorkspaceQuery()
  const [ingestReceipt, ingestState] = useIngestReceiptMutation()
  const [voidReceipt] = useVoidReceiptMutation()
  const [syncBatchDigests, syncState] = useSyncBatchDigestsMutation()
  const [releaseBatch, releaseState] = useReleaseBatchMutation()
  const [selectedPackageId, setSelectedPackageId] = useState(searchParams.get('package') ?? '')
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  const [failedArgs, setFailedArgs] = useState<ReleaseArgs | null>(null)

  const packagesWithBatches = useMemo(
    () => data?.packages.filter((item) => data.batches.some((batch) => batch.packageId === item.id)) ?? [],
    [data],
  )

  useEffect(() => {
    if (!selectedPackageId && packagesWithBatches[0]) setSelectedPackageId(packagesWithBatches[0].id)
  }, [packagesWithBatches, selectedPackageId])

  const packageBatches = useMemo(
    () =>
      (data?.batches.filter((batch) => batch.packageId === selectedPackageId) ?? []).sort(
        (left, right) => right.round - left.round,
      ),
    [data, selectedPackageId],
  )

  useEffect(() => {
    if (!packageBatches.some((batch) => batch.id === selectedBatchId)) {
      setSelectedBatchId(packageBatches[0]?.id ?? '')
    }
  }, [packageBatches, selectedBatchId])

  const batch = packageBatches.find((item) => item.id === selectedBatchId)
  const packageItem = data?.packages.find((item) => item.id === selectedPackageId)
  const receipts = useMemo(
    () => (data?.receipts.filter((item) => item.batchId === selectedBatchId) ?? []),
    [data, selectedBatchId],
  )

  if (isLoading || !data) return <div className="panel">正在加载对账批次...</div>
  const workspace = data

  const activeReceipts = receipts.filter((item) => item.status !== 'invalid')
  const pendingReceipts = activeReceipts.filter((item) => item.status === 'pending')
  const verifiedReceipts = activeReceipts.filter((item) => item.status === 'verified')
  const routeApproved =
    Boolean(packageItem?.approvalRoute.length) &&
    packageItem!.approvalRoute.every((step) => step.status === 'approved')

  const releaseConditions = batch
    ? [
        { label: '逐页脱敏摘要已补齐（补不全不放行）', ok: batch.digestComplete },
        { label: '没有版本不符的待核回执', ok: pendingReceipts.length === 0 },
        { label: '至少一张许可回执已核销', ok: verifiedReceipts.length >= 1 },
        { label: '审批路线全部通过', ok: routeApproved },
      ]
    : []

  const fileColumns: TableColumnsType<BatchFileFreeze> = [
    { title: '文件', dataIndex: 'fileName', minWidth: 180 },
    {
      title: '固化引用版本',
      width: 150,
      render: (_, record) => (
        <Space size={4}>
          <Tag color="blue">{record.versionLabel}</Tag>
          <span className="mono muted">{record.hash}</span>
        </Space>
      ),
    },
    {
      title: '脱敏摘要',
      width: 110,
      render: (_, record) => `${record.pages.length} 页`,
    },
    {
      title: '缺失说明',
      dataIndex: 'missing',
      render: (value: string[]) =>
        value.length ? (
          <span className="finding-action">{value.join('；')}</span>
        ) : (
          <span className="muted">无</span>
        ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, record) =>
        record.complete ? <Tag color="success">已补齐</Tag> : <Tag color="error">缺摘要</Tag>,
    },
  ]

  const receiptColumns: TableColumnsType<LicenseReceipt> = [
    { title: '回执号', dataIndex: 'receiptNo', width: 190, render: (value: string) => <span className="mono">{value}</span> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: LicenseReceipt['status']) => (
        <Tag color={receiptStatusColors[value]}>{receiptStatusLabels[value]}</Tag>
      ),
    },
    {
      title: '版本核对',
      minWidth: 260,
      render: (_, record) => {
        if (!batch) return null
        if (record.status === 'verified') return <span className="diff-after">与批次固化版本一致</span>
        if (record.status === 'invalid')
          return <span className="muted">{record.invalidReason ?? '已失效'}</span>
        const mismatches = receiptMismatches(batch, record)
        return <span className="diff-before">{mismatches.join('；') || '待核'}</span>
      },
    },
    {
      title: '接收时间',
      dataIndex: 'receivedAt',
      width: 165,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '备注',
      dataIndex: 'note',
      width: 170,
      render: (value: string) => value || <span className="muted">—</span>,
    },
    {
      title: '操作',
      width: 80,
      render: (_, record) =>
        record.status === 'pending' ? (
          <Button
            type="link"
            danger
            onClick={async () => {
              await voidReceipt({ receiptId: record.id, reason: '人工核销：确认平台回执版本有误' }).unwrap()
              message.success('待核回执已作废，批次状态已重算')
            }}
          >
            作废
          </Button>
        ) : null,
    },
  ]

  function frozenFileVersions(target: ReconBatch): Record<string, string> {
    return Object.fromEntries(target.files.map((file) => [file.fileId, file.versionId]))
  }

  async function ingest(kind: 'normal' | 'duplicate' | 'stale') {
    if (!batch) return
    let receiptNo = `PT-${Date.now().toString(36).toUpperCase()}`
    let packageVersionId = batch.packageVersionId
    let fileVersions = frozenFileVersions(batch)
    let note = '许可平台正常回执'
    if (kind === 'duplicate') {
      const last = receipts[0]
      if (!last) {
        message.warning('当前批次还没有回执，无法模拟重复推送')
        return
      }
      receiptNo = last.receiptNo
      packageVersionId = last.packageVersionId
      fileVersions = last.fileVersions
      note = '许可平台重复推送（应只入账一次）'
    } else if (kind === 'stale') {
      note = '许可平台旧版本回执（换版前已生成）'
      const staleFile = workspace.files.find(
        (file) =>
          file.packageId === batch.packageId &&
          file.versions.some(
            (version) =>
              version.id !== batch.files.find((entry) => entry.fileId === file.id)?.versionId,
          ),
      )
      if (staleFile) {
        const frozen = batch.files.find((entry) => entry.fileId === staleFile.id)
        const other = staleFile.versions.find((version) => version.id !== frozen?.versionId)
        if (other) fileVersions = { ...fileVersions, [staleFile.id]: other.id }
      } else {
        packageVersionId = 'pkg-version-legacy'
      }
    }
    try {
      await ingestReceipt({ batchId: batch.id, receiptNo, packageVersionId, fileVersions, note }).unwrap()
      if (kind === 'duplicate') message.info('重复回执已忽略：同一回执号只入账一次')
      else if (kind === 'stale') message.warning('回执版本与批次固化版本不符，已停在待核')
      else message.success('回执已入账并与批次固化版本核对一致')
    } catch (error) {
      message.error(errorText(error))
    }
  }

  async function release(args: ReleaseArgs) {
    setReleaseError('')
    try {
      await releaseBatch(args).unwrap()
      setFailedArgs(null)
      setSimulateFailure(false)
      message.success(`批次 ${batch?.code ?? ''} 已放行，许可记录生效`)
    } catch (error) {
      const text = errorText(error)
      setReleaseError(text)
      setFailedArgs({ ...args, simulateFailure: false })
      if (args.simulateFailure) setSimulateFailure(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="对账批次"
        description="送审固化资料包版本、文件引用版本、审批路线与逐页脱敏摘要；许可回执按批次对账，重复只入一次，版本不符停在待核。"
      />

      <div className="toolbar">
        <Select
          value={selectedPackageId || undefined}
          placeholder="选择资料包"
          style={{ width: 320 }}
          onChange={setSelectedPackageId}
          options={packagesWithBatches.map((item) => ({
            value: item.id,
            label: `${item.code} · ${item.title}`,
          }))}
        />
        <Select
          value={selectedBatchId || undefined}
          placeholder="选择对账批次"
          style={{ width: 220 }}
          onChange={setSelectedBatchId}
          options={packageBatches.map((item) => ({
            value: item.id,
            label: `${item.code} · 第 ${item.round} 轮`,
          }))}
        />
        <span className="grow" />
        {batch ? (
          <>
            <Tag color={batchStatusColors[batch.status]}>{batchStatusLabels[batch.status]}</Tag>
            <Tag>revision {batch.revision}</Tag>
            <Tag color={batch.digestComplete ? 'success' : 'error'}>
              {batch.digestComplete ? '摘要已补齐' : '摘要缺失'}
            </Tag>
          </>
        ) : null}
      </div>

      {!batch ? (
        <section className="panel">
          <Alert type="info" showIcon message="所选资料包还没有对账批次，提交审批（送审）后会自动固化生成。" />
        </section>
      ) : (
        <>
          <div className="two-column">
            <section className="panel">
              <div className="panel-title">
                <h3>批次固化内容</h3>
                <Space>
                  <Tag>{batch.code}</Tag>
                  <Button
                    size="small"
                    loading={syncState.isLoading}
                    disabled={batch.status === 'released' || batch.digestComplete}
                    onClick={async () => {
                      try {
                        await syncBatchDigests({ batchId: batch.id }).unwrap()
                        message.success('已按固化版本重新汇总逐页脱敏摘要')
                      } catch (error) {
                        message.error(errorText(error))
                      }
                    }}
                  >
                    同步逐页摘要
                  </Button>
                </Space>
              </div>
              <Descriptions column={2} bordered size="small" style={{ marginBottom: 16 }}>
                <Descriptions.Item label="资料包版本">
                  {packageItem?.versions.find((item) => item.id === batch.packageVersionId)?.label ??
                    '首次送审版本'}
                </Descriptions.Item>
                <Descriptions.Item label="审批轮次">第 {batch.round} 轮</Descriptions.Item>
                <Descriptions.Item label="固化时间">
                  {new Date(batch.createdAt).toLocaleString('zh-CN')}
                </Descriptions.Item>
                <Descriptions.Item label="固化人">{batch.createdBy}</Descriptions.Item>
                <Descriptions.Item label="放行时间">
                  {batch.releasedAt ? new Date(batch.releasedAt).toLocaleString('zh-CN') : '未放行'}
                </Descriptions.Item>
                <Descriptions.Item label="放行人">{batch.releasedBy ?? '—'}</Descriptions.Item>
              </Descriptions>
              <Table
                rowKey="fileId"
                columns={fileColumns}
                dataSource={batch.files}
                pagination={false}
                size="small"
                expandable={{
                  rowExpandable: (record) => record.pages.length > 0,
                  expandedRowRender: (record) => (
                    <Space wrap size={6}>
                      {record.pages.map((page) => (
                        <Tag key={page.pageId} className="mono">
                          第{page.page}页 · {page.digest} · {page.controlled ? '受控' : '一般'}
                          {page.desensitized ? ' · 已脱敏' : ''}
                        </Tag>
                      ))}
                    </Space>
                  ),
                }}
              />
              <div style={{ marginTop: 14 }}>
                <strong>审批路线快照</strong>
                <div style={{ marginTop: 8 }}>
                  <Space wrap size={6}>
                    {batch.routeSnapshot.map((step) => (
                      <Tag key={step.stepId}>
                        {step.order}. {step.role} · {step.assignee}
                      </Tag>
                    ))}
                  </Space>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-title">
                <h3>放行控制</h3>
                <SafetyCertificateOutlined />
              </div>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {releaseConditions.map((condition) => (
                  <div key={condition.label}>
                    {condition.ok ? (
                      <CheckCircleFilled style={{ color: '#2e8b57', marginRight: 8 }} />
                    ) : (
                      <CloseCircleFilled style={{ color: '#c74d4d', marginRight: 8 }} />
                    )}
                    {condition.label}
                  </div>
                ))}
                <Alert
                  type="info"
                  showIcon
                  message="双人同时确认只放行一个"
                  description="放行按批次 revision 做乐观校验，写入前再核对存储中的批次状态；并发确认时后到的请求会被拦截。"
                />
                <div>
                  <Switch
                    checked={simulateFailure}
                    onChange={setSimulateFailure}
                    disabled={batch.status === 'released'}
                  />
                  <span style={{ marginLeft: 8 }}>模拟写入失败（验证失败后从完整批次重试）</span>
                </div>
                <Button
                  type="primary"
                  block
                  disabled={batch.status === 'released'}
                  loading={releaseState.isLoading}
                  onClick={() =>
                    release({
                      batchId: batch.id,
                      expectedRevision: batch.revision,
                      operator: '合规专员',
                      simulateFailure: simulateFailure || undefined,
                    })
                  }
                >
                  {batch.status === 'released' ? '批次已放行' : '确认放行'}
                </Button>
                {releaseError ? (
                  <Alert
                    type="error"
                    showIcon
                    message={releaseError}
                    description={
                      failedArgs ? (
                        <Space direction="vertical" size={8} style={{ marginTop: 6 }}>
                          <span>写入未产生部分数据，重试将重新提交完整批次。</span>
                          <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            loading={releaseState.isLoading}
                            onClick={() =>
                              release({ ...failedArgs, expectedRevision: batch.revision })
                            }
                          >
                            从完整批次重试
                          </Button>
                        </Space>
                      ) : undefined
                    }
                  />
                ) : null}
              </Space>
            </section>
          </div>

          <section className="panel">
            <div className="panel-title">
              <h3>许可回执</h3>
              <Space>
                <Badge count={pendingReceipts.length} size="small" offset={[-4, 2]}>
                  <Tag color="warning">待核</Tag>
                </Badge>
                <Tag color="success">已核 {verifiedReceipts.length}</Tag>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<CloudUploadOutlined />}
                  loading={ingestState.isLoading}
                  disabled={batch.status === 'released'}
                  onClick={() => ingest('normal')}
                >
                  模拟正常回执
                </Button>
                <Button
                  size="small"
                  loading={ingestState.isLoading}
                  disabled={batch.status === 'released'}
                  onClick={() => ingest('duplicate')}
                >
                  重发上一张（重复）
                </Button>
                <Button
                  size="small"
                  danger
                  loading={ingestState.isLoading}
                  disabled={batch.status === 'released'}
                  onClick={() => ingest('stale')}
                >
                  模拟旧版本回执
                </Button>
              </Space>
            </div>
            <Table
              rowKey="id"
              columns={receiptColumns}
              dataSource={receipts}
              pagination={false}
              locale={{ emptyText: '许可平台回执尚未到达，批次保持对账中' }}
            />
          </section>
        </>
      )}
    </div>
  )
}

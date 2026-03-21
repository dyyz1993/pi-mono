import { Form, Input, Modal, Select, Switch } from 'antd'

interface UserFormData {
  username: string
  email: string
  role: string
  status: boolean
}

interface UserFormModalProps {
  open: boolean
  title: string
  initialValues?: Partial<UserFormData>
  onOk: (values: UserFormData) => void
  onCancel: () => void
  loading?: boolean
}

export const UserFormModal: React.FC<UserFormModalProps> = ({
  open,
  title,
  initialValues,
  onOk,
  onCancel,
  loading,
}) => {
  const [form] = Form.useForm()

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      onOk(values)
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onCancel()
  }

  return (
    <Modal
      open={open}
      title={title}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
    >
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item name="username" label="Username" rules={[{ required: true }]}>
          <Input placeholder="Enter username" />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input placeholder="Enter email" />
        </Form.Item>
        <Form.Item name="role" label="Role" rules={[{ required: true }]}>
          <Select placeholder="Select role">
            <Select.Option value="admin">Admin</Select.Option>
            <Select.Option value="user">User</Select.Option>
            <Select.Option value="guest">Guest</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="status" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}

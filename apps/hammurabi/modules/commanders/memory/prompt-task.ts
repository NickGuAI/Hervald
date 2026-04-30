export interface PromptTaskLabel {
  name: string
}

export interface PromptTaskComment {
  author?: string
  createdAt?: string
  body: string
}

export interface PromptTask {
  number: number
  title: string
  body?: string
  labels?: PromptTaskLabel[]
  owner?: string
  repo?: string
  repository?: string
  comments?: PromptTaskComment[]
}

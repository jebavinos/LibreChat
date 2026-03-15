import { visit } from 'unist-util-visit';
import type { Pluggable } from 'unified';

export const remarkToolResult: Pluggable = () => {
  return (tree) => {
    visit(tree, 'text', (node: any) => { // using any because unist types can be tricky
      if (typeof node.value === 'string') {
        // Remove <tool-result> and </tool-result> tags from text
        node.value = node.value.replace(/<\/?tool-result>/g, '');
      }
    });
  };
};

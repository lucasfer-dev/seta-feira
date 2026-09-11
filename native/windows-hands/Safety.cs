using System.Text.RegularExpressions;

namespace Sexta.NativeHands
{
    internal static class Safety
    {
        private static readonly Regex Sensitive = new Regex(@"\b(send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|instalar|desinstalar)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex Credential = new Regex(@"(\[password\]|\bpassword\b|\bsenha\b|\bpasscode\b|\bpin\b|\b2fa\b|\botp\b)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        internal static bool IsSensitive(string value) { return Sensitive.IsMatch(Semantic(value)); }
        internal static bool IsCredential(string value) { return Credential.IsMatch(Semantic(value)); }
        private static string Semantic(string value)
        {
            return Regex.Replace((value ?? string.Empty).Replace("_", " ").Replace("-", " "), "([a-z0-9])([A-Z])", "$1 $2");
        }
    }
}

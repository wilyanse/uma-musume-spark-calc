using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;
namespace Uma.Agent.Windows.Portable.Tests;
public class HardeningTests
{
    [Theory]
    [InlineData("a", "secret\n")]
    [InlineData("id\r", "secret")]
    public void Token_controls_are_rejected_before_any_trimming(string id, string secret)
    {
        var dir=Temp.Dir();
        try { var store=new ServiceTokenStore(Path.Combine(dir,"t.bin"),new XorProtector()); Assert.Throws<ShellValidationException>(()=>store.Save(id,secret)); Assert.False(store.HasToken); }
        finally { Temp.Drop(dir); }
    }
    [Fact] public void Token_values_are_not_silently_normalized()
    {
        var dir=Temp.Dir();
        try { var store=new ServiceTokenStore(Path.Combine(dir,"t.bin"),new XorProtector()); store.Save(" id "," secret "); Assert.Equal((" id "," secret "),store.Read()); }
        finally { Temp.Drop(dir); }
    }
    [Fact] public void Same_dhash_scroll_collision_is_reprocessed_after_injected_refresh_time()
    {
        var r=Repo.Instance; var clock=new TestClock(); var gate=new FrameGate(clock,TimeSpan.FromSeconds(2));
        var a=r.Frame(Repo.McQueen[1]); var b=r.Frame(Repo.McQueen[2]);
        Assert.Equal(FrameGate.Hash(a),FrameGate.Hash(b)); // real collision discovered in the first run, not invented
        Assert.True(gate.ShouldProcess(a)); Assert.False(gate.ShouldProcess(b));
        clock.UtcNow += TimeSpan.FromSeconds(2); Assert.True(gate.ShouldProcess(b));
    }
    [Fact] public void Data_bundle_public_template_map_is_read_only()
    {
        var templates=Repo.Instance.Data.Templates;
        if(templates is IDictionary<string,TemplateSet> mutable) Assert.Throws<NotSupportedException>(()=>mutable.Clear());
        Assert.NotEmpty(templates);
    }
}
